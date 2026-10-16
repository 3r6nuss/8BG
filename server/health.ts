import { constants, accessSync, statfsSync } from 'node:fs';
import path from 'node:path';
import { getHeapStatistics } from 'node:v8';
import sharp from 'sharp';
import type { Database } from './database.js';
import { germanTrainingDataPath } from './ocr.js';

type CheckStatus = 'up' | 'degraded' | 'down';
interface HealthCheck {
  id: string;
  name: string;
  status: CheckStatus;
  message: string | null;
  metrics?: Record<string, number>;
}

const MIB = 1024 * 1024;
const REQUIRED_TABLES = ['users', 'sessions', 'scans', 'persons', 'products', 'purchases', 'purchase_items'];

export function createHealthReporter(db: Database, dataDir: string, clock = Date.now) {
  let integrityCheckedAt = 0;
  let integrityStatus: CheckStatus = 'up';

  function check(
    id: string,
    name: string,
    status: CheckStatus,
    message: string | null = null,
    metrics?: Record<string, number>,
  ): HealthCheck {
    return { id, name, status, message, ...(metrics ? { metrics } : {}) };
  }

  return function reportHealth() {
    const checks: HealthCheck[] = [];
    const uptimeSeconds = Math.floor(process.uptime());
    checks.push(check('application', '8BG-Anwendung', 'up', null, { uptimeSeconds }));
    checks.push(check(
      'node_runtime',
      'Node.js-Laufzeit',
      Number(process.versions.node.split('.')[0]) >= 24 ? 'up' : 'degraded',
      Number(process.versions.node.split('.')[0]) >= 24 ? null : 'Node.js 24 oder neuer wird empfohlen.',
      { majorVersion: Number(process.versions.node.split('.')[0]) },
    ));

    try {
      db.prepare('SELECT 1 AS connected').get();
      checks.push(check('database', 'SQLite-Datenbank', 'up'));
    } catch {
      checks.push(check('database', 'SQLite-Datenbank', 'down', 'Datenbankabfrage fehlgeschlagen.'));
    }

    try {
      const columns = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
      const existing = new Set(columns.map(column => column.name));
      const missing = REQUIRED_TABLES.filter(table => !existing.has(table));
      checks.push(missing.length
        ? check('database_schema', 'Datenbankschema', 'down', 'Erforderliche Anwendungsdaten fehlen.')
        : check('database_schema', 'Datenbankschema', 'up'));
    } catch {
      checks.push(check('database_schema', 'Datenbankschema', 'down', 'Datenbankschema konnte nicht geprüft werden.'));
    }

    if (clock() - integrityCheckedAt >= 60_000) {
      integrityCheckedAt = clock();
      try {
        const result = db.prepare('PRAGMA quick_check(1)').get() as { quick_check?: string } | undefined;
        integrityStatus = result?.quick_check === 'ok' ? 'up' : 'down';
      } catch {
        integrityStatus = 'down';
      }
    }
    checks.push(check(
      'database_integrity',
      'Datenbankintegrität',
      integrityStatus,
      integrityStatus === 'up' ? null : 'Integritätsprüfung fehlgeschlagen.',
    ));

    for (const [id, name, directory] of [
      ['data_directory', 'Datenspeicher', dataDir],
      ['upload_storage', 'Ausweisbild-Speicher', path.join(dataDir, 'uploads')],
    ] as const) {
      try {
        accessSync(directory, constants.R_OK | constants.W_OK);
        checks.push(check(id, name, 'up'));
      } catch {
        checks.push(check(id, name, 'down', 'Speicher ist nicht les- und beschreibbar.'));
      }
    }

    try {
      const disk = statfsSync(dataDir);
      const availableMiB = Math.floor((disk.bavail * disk.bsize) / MIB);
      const status: CheckStatus = availableMiB < 128 ? 'down' : availableMiB < 512 ? 'degraded' : 'up';
      checks.push(check(
        'disk_space',
        'Freier Speicherplatz',
        status,
        status === 'down' ? 'Kritisch wenig freier Speicherplatz.' : status === 'degraded' ? 'Freier Speicherplatz wird knapp.' : null,
        { availableMiB, totalMiB: Math.floor((disk.blocks * disk.bsize) / MIB) },
      ));
    } catch {
      checks.push(check('disk_space', 'Freier Speicherplatz', 'degraded', 'Speicherplatz konnte nicht abgefragt werden.'));
    }

    try {
      accessSync(germanTrainingDataPath(), constants.R_OK);
      checks.push(check('german_ocr', 'Deutsche Ausweis-Texterkennung', 'up'));
    } catch {
      checks.push(check('german_ocr', 'Deutsche Ausweis-Texterkennung', 'degraded', 'Deutsche OCR-Sprachdaten sind nicht lesbar.'));
    }

    const webpAvailable = Boolean(sharp.format.webp?.output?.file);
    checks.push(check(
      'webp_encoder',
      'WebP-Bildverarbeitung',
      webpAvailable ? 'up' : 'down',
      webpAvailable ? null : 'WebP-Bildverarbeitung ist nicht verfügbar.',
    ));

    const heap = getHeapStatistics();
    const memory = process.memoryUsage();
    const heapUsedPercent = Math.round((memory.heapUsed / heap.heap_size_limit) * 100);
    const memoryStatus: CheckStatus = heapUsedPercent >= 98 ? 'down' : heapUsedPercent >= 85 ? 'degraded' : 'up';
    checks.push(check(
      'memory',
      'Prozessspeicher',
      memoryStatus,
      memoryStatus === 'down' ? 'Prozessspeicher ist nahezu ausgeschöpft.' : memoryStatus === 'degraded' ? 'Prozessspeicher ist erhöht.' : null,
      { heapUsedMiB: Math.round(memory.heapUsed / MIB), heapLimitMiB: Math.round(heap.heap_size_limit / MIB), heapUsedPercent },
    ));

    try {
      const row = db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE expires_at<=?').get(clock()) as { count: number };
      const status: CheckStatus = row.count >= 10_000 ? 'down' : row.count >= 1_000 ? 'degraded' : 'up';
      checks.push(check(
        'session_backlog',
        'Abgelaufene Sitzungen',
        status,
        status === 'down' ? 'Sehr viele abgelaufene Sitzungen warten auf Bereinigung.' : status === 'degraded' ? 'Abgelaufene Sitzungen warten auf Bereinigung.' : null,
        { expiredSessions: row.count },
      ));
    } catch {
      checks.push(check('session_backlog', 'Sitzungsbereinigung', 'degraded', 'Sitzungsbereinigung konnte nicht geprüft werden.'));
    }

    const status: CheckStatus = checks.some(item => item.status === 'down')
      ? 'down' : checks.some(item => item.status === 'degraded') ? 'degraded' : 'up';
    return {
      ok: status !== 'down',
      service: '8bg',
      status,
      checkedAt: new Date(clock()).toISOString(),
      uptimeSeconds,
      checks,
    };
  };
}
