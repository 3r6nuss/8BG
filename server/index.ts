import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createApp } from './app.js';
import { openDatabase } from './database.js';
import { cleanup } from './maintenance.js';

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT muss zwischen 1 und 65535 liegen.');
const host = process.env.HOST ?? '127.0.0.1';
const dataDir = path.resolve(process.env.DATA_DIR ?? '.data');
const db = openDatabase(dataDir);
const bootstrapToken = randomBytes(24).toString('hex');
if (!db.prepare('SELECT id FROM users LIMIT 1').get()) {
  console.log(`\n8BG Ersteinrichtung – einmaliger Einrichtungsschlüssel:\n${bootstrapToken}\nNur im Browser bei der ersten Einrichtung eingeben. Nicht weitergeben.\n`);
}
const app = createApp({
  db, dataDir, bootstrapToken,
  secureCookie: process.env.COOKIE_SECURE === '1',
  origin: process.env.APP_ORIGIN,
  distDir: process.argv.includes('--dev') ? undefined : path.resolve('dist'),
});
cleanup(db, dataDir);
const maintenance = setInterval(() => {
  try { cleanup(db, dataDir); }
  catch (error) { console.error('Bereinigung fehlgeschlagen:', error); }
}, 60 * 60_000);
maintenance.unref();
const server = app.listen(port, host, () => {
  console.log(`8BG läuft unter http://${host}:${port} · Daten: ${dataDir}`);
});
server.on('error', error => { console.error('8BG konnte nicht starten:', error); clearInterval(maintenance); db.close(); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    clearInterval(maintenance);
    server.close(() => { db.close(); process.exit(0); });
  });
}
