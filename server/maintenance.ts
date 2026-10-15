import { unlinkSync } from 'node:fs';
import path from 'node:path';
import type { Database } from './database.js';

export function removeUnusedScan(db: Database, dataDir: string, id: string | null) {
  if (!id || db.prepare('SELECT id FROM persons WHERE scan_id=? LIMIT 1').get(id)) return;
  const scan = db.prepare('SELECT filename FROM scans WHERE id=?').get(id) as { filename: string } | undefined;
  if (!scan) return;
  try {
    unlinkSync(path.join(dataDir, 'uploads', scan.filename));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  db.prepare('DELETE FROM scans WHERE id=?').run(id);
}

export function cleanup(db: Database, dataDir: string) {
  db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
  const cutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const scans = db.prepare(`SELECT id FROM scans WHERE created_at<?
    AND NOT EXISTS (SELECT 1 FROM persons WHERE scan_id=scans.id)`).all(cutoff) as { id: string }[];
  for (const scan of scans) removeUnusedScan(db, dataDir, scan.id);
}
