import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';

const dir = mkdtempSync(path.join(tmpdir(), '8bg-browser-'));
const db = openDatabase(dir);
const app = createApp({
  db, dataDir: dir, bootstrapToken: 'browser-test-setup-token', distDir: path.resolve('dist'),
});
const server = app.listen(4318, '127.0.0.1');
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
process.on('exit', cleanup);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => { cleanup(); process.exit(0); }));
}
