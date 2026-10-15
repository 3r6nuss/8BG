import express, { type ErrorRequestHandler, type Request, type Response } from 'express';
import helmet from 'helmet';
import multer from 'multer';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Database } from './database.js';
import { transaction } from './database.js';
import { adminOnly, authenticate, clearSession, hashPassword, hashToken, issueSession, verifyPassword, type User } from './auth.js';
import { extractFields, recognizeId } from './ocr.js';
import { removeUnusedScan } from './maintenance.js';

interface AppOptions {
  db: Database;
  dataDir: string;
  bootstrapToken: string;
  secureCookie?: boolean;
  origin?: string;
  distDir?: string;
  recognize?: typeof recognizeId;
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const credentials = z.object({
  username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9_.-]+$/, 'Benutzername: nur Buchstaben, Zahlen, Punkt, Unterstrich und Bindestrich.'),
  password: z.string().min(12, 'Das Passwort muss mindestens 12 Zeichen enthalten.').max(128),
});
const birthDate = z.string().refine(value => {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
    && value <= new Date().toISOString().slice(0, 10);
}, 'Bitte ein gültiges Geburtsdatum angeben, das nicht in der Zukunft liegt.');
const personSchema = z.object({
  name: z.string().trim().min(2).max(100),
  birthDate: birthDate.default(''),
  phone: z.string().trim().max(50).default(''),
  notes: z.string().trim().max(5000).default(''),
  scanId: z.uuid().nullable().default(null),
});
const productSchema = z.object({
  name: z.string().trim().min(1).max(100),
  priceCents: z.number().int().min(0).max(100_000_000),
});
const purchaseSchema = z.object({
  personId: z.uuid(),
  requestId: z.uuid(),
  notes: z.string().trim().max(2000).default(''),
  items: z.array(z.object({
    productId: z.uuid(), quantity: z.number().int().min(1).max(1_000_000),
    unitPriceCents: z.number().int().min(0).max(100_000_000),
  })).min(1).max(200),
});

const personColumns = `id,name,birth_date AS birthDate,phone,notes,scan_id AS scanId,archived,created_at AS createdAt`;
const productColumns = 'id,name,price_cents AS priceCents,active';
const purchaseColumns = `p.id,p.person_id AS personId,p.person_name AS personName,p.total_cents AS totalCents,
  p.notes,p.created_at AS createdAt,u.username AS createdBy`;

export function createApp(options: AppOptions) {
  const { db, dataDir, bootstrapToken, secureCookie = false, origin, distDir, recognize = recognizeId } = options;
  const app = express();
  const bootstrapHash = hashToken(bootstrapToken);
  const dummyPassword = hashPassword(randomUUID());
  let scanning = false;
  const attempts = new Map<string, { count: number; until: number }>();
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"],
        imgSrc: ["'self'", 'blob:', 'data:'], connectSrc: ["'self'"],
        upgradeInsecureRequests: secureCookie ? [] : null,
      },
    },
    strictTransportSecurity: secureCookie ? undefined : false,
  }));
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use(express.json({ limit: '64kb' }));
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const requestOrigin = req.get('origin');
      const expected = origin ?? `${secureCookie ? 'https' : 'http'}://${req.get('host')}`;
      const devOrigin = !distDir && ['http://127.0.0.1:5173', 'http://localhost:5173'].includes(requestOrigin ?? '');
      if (requestOrigin && requestOrigin !== expected && !devOrigin) {
        throw new HttpError(403, 'Anfragen von dieser Website sind nicht erlaubt.');
      }
    }
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/auth/status', (_req, res) => {
    res.json({ needsSetup: !db.prepare('SELECT id FROM users LIMIT 1').get() });
  });
  app.use(['/api/auth/login', '/api/auth/setup'], (req, res, next) => {
    if (req.method !== 'POST') return next();
    if (!req.is('application/json')) throw new HttpError(415, 'JSON-Anfrage erforderlich.');
    const now = Date.now();
    for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
    const key = req.ip ?? 'unknown';
    const entry = attempts.get(key) ?? { count: 0, until: now + 15 * 60_000 };
    attempts.set(key, entry);
    entry.count++;
    if (entry.count > 30) {
      res.setHeader('Retry-After', String(Math.ceil((entry.until - now) / 1000)));
      throw new HttpError(429, 'Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.');
    }
    next();
  });
  app.post('/api/auth/setup', async (req, res) => {
    const data = credentials.extend({ token: z.string().min(1).max(200) }).parse(req.body);
    if (hashToken(data.token) !== bootstrapHash) throw new HttpError(403, 'Der Einrichtungsschlüssel ist ungültig.');
    const passwordHash = await hashPassword(data.password);
    const user: User = { id: randomUUID(), username: data.username, role: 'admin' };
    transaction(db, () => {
      if (db.prepare('SELECT id FROM users LIMIT 1').get()) throw new HttpError(409, 'Die Einrichtung wurde bereits abgeschlossen.');
      db.prepare('INSERT INTO users (id,username,password_hash,role) VALUES (?,?,?,?)')
        .run(user.id, user.username, passwordHash, user.role);
    });
    const csrfToken = issueSession(db, res, user.id, secureCookie);
    res.status(201).json({ user, csrfToken });
  });
  app.post('/api/auth/login', async (req, res) => {
    const data = credentials.parse(req.body);
    const row = db.prepare('SELECT id,username,role,password_hash FROM users WHERE username=?')
      .get(data.username) as (User & { password_hash: string }) | undefined;
    const valid = await verifyPassword(data.password, row?.password_hash ?? await dummyPassword);
    if (!row || !valid) throw new HttpError(401, 'Benutzername oder Passwort ist falsch.');
    const user: User = { id: row.id, username: row.username, role: row.role };
    res.json({ user, csrfToken: issueSession(db, res, user.id, secureCookie) });
  });

  app.use('/api', authenticate(db));
  app.get('/api/auth/me', (req, res) => res.json({ user: req.user, csrfToken: req.csrfToken }));
  app.post('/api/auth/logout', (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(req.sessionHash!);
    clearSession(res, secureCookie);
    res.sendStatus(204);
  });
  app.put('/api/auth/password', async (req, res) => {
    const data = z.object({ currentPassword: z.string().max(128), password: credentials.shape.password }).parse(req.body);
    const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user!.id) as { password_hash: string };
    if (!await verifyPassword(data.currentPassword, row.password_hash)) throw new HttpError(403, 'Das bisherige Passwort ist falsch.');
    const passwordHash = await hashPassword(data.password);
    transaction(db, () => {
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash, req.user!.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.user!.id);
    });
    res.json({ csrfToken: issueSession(db, res, req.user!.id, secureCookie) });
  });
  app.get('/api/users', adminOnly, (_req, res) => {
    res.json(db.prepare('SELECT id,username,role,created_at AS createdAt FROM users ORDER BY username').all());
  });
  app.post('/api/users', adminOnly, async (req, res) => {
    const data = credentials.extend({ role: z.enum(['admin', 'member']).default('member') }).parse(req.body);
    const id = randomUUID();
    const passwordHash = await hashPassword(data.password);
    db.prepare('INSERT INTO users (id,username,password_hash,role) VALUES (?,?,?,?)')
      .run(id, data.username, passwordHash, data.role);
    res.status(201).json({ id, username: data.username, role: data.role });
  });
  app.delete('/api/users/:id', adminOnly, (req, res) => {
    const id = z.uuid().parse(req.params.id);
    if (id === req.user!.id) throw new HttpError(400, 'Du kannst deinen eigenen Zugang nicht löschen.');
    if (db.prepare('SELECT id FROM purchases WHERE created_by=? LIMIT 1').get(id)
      || db.prepare('SELECT id FROM scans WHERE created_by=? LIMIT 1').get(id)) {
      throw new HttpError(409, 'Dieser Zugang hat verknüpfte Datensätze und kann nicht gelöscht werden. Ein Passwort-Reset beendet alle seine Sitzungen.');
    }
    const result = db.prepare('DELETE FROM users WHERE id=?').run(id);
    if (!result.changes) throw new HttpError(404, 'Benutzer nicht gefunden.');
    res.sendStatus(204);
  });
  app.post('/api/users/:id/reset-password', adminOnly, async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const { password } = z.object({ password: credentials.shape.password }).parse(req.body);
    const passwordHash = await hashPassword(password);
    transaction(db, () => {
      const result = db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash, id);
      if (!result.changes) throw new HttpError(404, 'Benutzer nicht gefunden.');
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    });
    res.sendStatus(204);
  });

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 1, fields: 0 } });
  app.post('/api/id-scans', (req, res, next) => {
    if (scanning) throw new HttpError(429, 'Es wird bereits ein Ausweis verarbeitet. Bitte kurz warten.');
    scanning = true;
    let released = false;
    const release = () => { if (!released) { released = true; scanning = false; } };
    res.once('finish', release);
    // Keep the processing slot until OCR finishes, even if the browser disconnects.
    upload.single('image')(req, res, error => {
      if (error) { release(); next(error); return; }
      processScan(req, res).catch(next).finally(release);
    });
  });
  async function processScan(req: Request, res: Response) {
    if (!req.file) throw new HttpError(400, 'Bitte ein Ausweisbild auswählen.');
    let webp: Buffer;
    try {
      const image = sharp(req.file.buffer, { limitInputPixels: 20_000_000, failOn: 'warning' });
      const meta = await image.metadata();
      if (!['png', 'jpeg', 'webp'].includes(meta.format ?? '') || (meta.pages ?? 1) > 1) {
        throw new Error('Unsupported image format');
      }
      webp = await image.rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 90 }).toBuffer();
    } catch (error) {
      console.warn('Ausweis-Konvertierung abgelehnt:', error instanceof Error ? error.message : error);
      throw new HttpError(400, 'Das Bild ist ungültig. Erlaubt: JPG, PNG oder WebP, maximal 12 MB und 20 Megapixel.');
    }
    const id = randomUUID();
    const filename = `${id}.webp`;
    await writeFile(path.join(dataDir, 'uploads', filename), webp, { flag: 'wx', mode: 0o600 });
    try {
      db.prepare('INSERT INTO scans (id,filename,created_by) VALUES (?,?,?)').run(id, filename, req.user!.id);
    } catch (error) {
      await unlink(path.join(dataDir, 'uploads', filename));
      throw error;
    }
    let text = '';
    let warning: string | null = null;
    try {
      text = await recognize(webp);
    } catch (error) {
      console.error('Lokale Texterkennung fehlgeschlagen:', error);
      warning = 'Das WebP-Bild wurde gespeichert, die Texterkennung ist jedoch fehlgeschlagen. Bitte Daten manuell eintragen.';
    }
    const fields = extractFields(text);
    if (!warning && (!fields.name || !fields.birthDate)) {
      warning = 'Nicht alle Felder konnten sicher erkannt werden. Bitte Name und Geburtsdatum prüfen und ergänzen.';
    }
    res.status(201).json({ scanId: id, imageUrl: `/api/id-scans/${id}/image`, fields, text, warning });
  }
  app.get('/api/id-scans/:id/image', (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const row = db.prepare(`SELECT filename FROM scans WHERE id=? AND
      (created_by=? OR EXISTS (SELECT 1 FROM persons WHERE scan_id=scans.id))`)
      .get(id, req.user!.id) as { filename: string } | undefined;
    if (!row) throw new HttpError(404, 'Ausweisbild nicht gefunden.');
    res.type('webp').sendFile(path.resolve(dataDir, 'uploads', row.filename));
  });
  app.delete('/api/id-scans/:id', async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const row = db.prepare('SELECT created_by FROM scans WHERE id=?').get(id) as { created_by: string } | undefined;
    if (!row || row.created_by !== req.user!.id) throw new HttpError(404, 'Ausweisbild nicht gefunden.');
    if (db.prepare('SELECT id FROM persons WHERE scan_id=?').get(id)) {
      throw new HttpError(409, 'Das Bild ist einer Person zugeordnet. Bitte dort entfernen.');
    }
    removeUnusedScan(db, dataDir, id);
    res.sendStatus(204);
  });

  app.get('/api/persons', (_req, res) => {
    res.json(db.prepare(`SELECT ${personColumns} FROM persons ORDER BY archived,name COLLATE NOCASE`).all());
  });
  function validateScan(scanId: string | null, userId: string, oldScanId: string | null = null) {
    if (scanId && scanId !== oldScanId) {
      if (!db.prepare('SELECT id FROM scans WHERE id=? AND created_by=?').get(scanId, userId)) {
        throw new HttpError(400, 'Dieses Ausweisbild steht nicht zur Verfügung.');
      }
    }
  }
  app.post('/api/persons', (req, res) => {
    const data = personSchema.parse(req.body);
    validateScan(data.scanId, req.user!.id);
    const id = randomUUID();
    db.prepare('INSERT INTO persons (id,name,birth_date,phone,notes,scan_id) VALUES (?,?,?,?,?,?)')
      .run(id, data.name, data.birthDate, data.phone, data.notes, data.scanId);
    res.status(201).json(db.prepare(`SELECT ${personColumns} FROM persons WHERE id=?`).get(id));
  });
  app.put('/api/persons/:id', async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const data = personSchema.extend({ archived: z.boolean().default(false) }).parse(req.body);
    const old = db.prepare('SELECT scan_id FROM persons WHERE id=?').get(id) as { scan_id: string | null } | undefined;
    if (!old) throw new HttpError(404, 'Person nicht gefunden.');
    validateScan(data.scanId, req.user!.id, old.scan_id);
    db.prepare('UPDATE persons SET name=?,birth_date=?,phone=?,notes=?,scan_id=?,archived=? WHERE id=?')
      .run(data.name, data.birthDate, data.phone, data.notes, data.scanId, Number(data.archived), id);
    if (old.scan_id !== data.scanId) removeUnusedScan(db, dataDir, old.scan_id);
    res.json(db.prepare(`SELECT ${personColumns} FROM persons WHERE id=?`).get(id));
  });
  app.delete('/api/persons/:id', adminOnly, async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const old = db.prepare('SELECT scan_id FROM persons WHERE id=?').get(id) as { scan_id: string | null } | undefined;
    if (!old) throw new HttpError(404, 'Person nicht gefunden.');
    if (db.prepare('SELECT id FROM purchases WHERE person_id=? LIMIT 1').get(id)) {
      throw new HttpError(409, 'Zu dieser Person existieren Ankäufe. Bitte die Person stattdessen archivieren.');
    }
    db.prepare('DELETE FROM persons WHERE id=?').run(id);
    removeUnusedScan(db, dataDir, old.scan_id);
    res.sendStatus(204);
  });
  app.get('/api/products', (_req, res) => res.json(db.prepare(`SELECT ${productColumns} FROM products ORDER BY name COLLATE NOCASE`).all()));
  app.post('/api/products', adminOnly, (req, res) => {
    const data = productSchema.parse(req.body);
    const id = randomUUID();
    db.prepare('INSERT INTO products (id,name,price_cents) VALUES (?,?,?)').run(id, data.name, data.priceCents);
    res.status(201).json(db.prepare(`SELECT ${productColumns} FROM products WHERE id=?`).get(id));
  });
  app.put('/api/products/:id', adminOnly, (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const data = productSchema.extend({ active: z.boolean() }).parse(req.body);
    const result = db.prepare('UPDATE products SET name=?,price_cents=?,active=? WHERE id=?')
      .run(data.name, data.priceCents, Number(data.active), id);
    if (!result.changes) throw new HttpError(404, 'Produkt nicht gefunden.');
    res.json(db.prepare(`SELECT ${productColumns} FROM products WHERE id=?`).get(id));
  });

  app.get('/api/purchases', (req, res) => {
    const { page } = z.object({ page: z.coerce.number().int().min(1).default(1) }).parse(req.query);
    const purchases = db.prepare(`SELECT ${purchaseColumns} FROM purchases p JOIN users u ON p.created_by=u.id
      ORDER BY p.created_at DESC,p.rowid DESC LIMIT 50 OFFSET ?`).all((page - 1) * 50);
    const count = db.prepare('SELECT COUNT(*) AS total FROM purchases').get() as { total: number };
    res.json({ items: purchases, total: count.total, page, pageSize: 50 });
  });
  app.get('/api/purchases/:id', (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const purchase = db.prepare(`SELECT ${purchaseColumns} FROM purchases p JOIN users u ON p.created_by=u.id WHERE p.id=?`).get(id);
    if (!purchase) throw new HttpError(404, 'Ankauf nicht gefunden.');
    res.json({
      ...purchase,
      items: db.prepare(`SELECT product_id AS productId,product_name AS productName,unit_price_cents AS unitPriceCents,
        quantity,total_cents AS totalCents FROM purchase_items WHERE purchase_id=? ORDER BY id`).all(id),
    });
  });
  app.post('/api/purchases', (req, res) => {
    const data = purchaseSchema.parse(req.body);
    if (new Set(data.items.map(item => item.productId)).size !== data.items.length) {
      throw new HttpError(400, 'Ein Produkt darf nur einmal je Ankauf vorkommen.');
    }
    const result = transaction(db, () => {
      const requestHash = hashToken(JSON.stringify(data));
      const existing = db.prepare('SELECT id,total_cents AS totalCents,request_hash FROM purchases WHERE created_by=? AND request_id=?')
        .get(req.user!.id, data.requestId) as { id: string; totalCents: number; request_hash: string } | undefined;
      if (existing) {
        if (existing.request_hash !== requestHash) {
          throw new HttpError(409, 'Dieser Ankauf wurde bereits mit anderen Daten gespeichert. Bitte den Verlauf prüfen und den Rechner für einen neuen Ankauf zurücksetzen.');
        }
        return { purchase: { id: existing.id, totalCents: existing.totalCents }, duplicate: true };
      }
      const person = db.prepare('SELECT name FROM persons WHERE id=? AND archived=0').get(data.personId) as { name: string } | undefined;
      if (!person) throw new HttpError(400, 'Bitte eine aktive Person auswählen.');
      const items = data.items.map(item => {
        const product = db.prepare('SELECT name,price_cents FROM products WHERE id=? AND active=1')
          .get(item.productId) as { name: string; price_cents: number } | undefined;
        if (!product) throw new HttpError(409, 'Ein Produkt ist nicht mehr verfügbar. Bitte Produkte neu laden.');
        if (product.price_cents !== item.unitPriceCents) {
          throw new HttpError(409, 'Ein Produktpreis wurde zwischenzeitlich geändert. Bitte die Seite neu laden und den Betrag erneut prüfen.');
        }
        return { ...item, name: product.name, priceCents: product.price_cents, total: product.price_cents * item.quantity };
      });
      const totalCents = items.reduce((sum, item) => sum + item.total, 0);
      if (!Number.isSafeInteger(totalCents) || totalCents > 1_000_000_000_000) {
        throw new HttpError(400, 'Der Gesamtbetrag ist zu hoch (maximal 10 Milliarden $).');
      }
      const id = randomUUID();
      db.prepare('INSERT INTO purchases (id,person_id,person_name,created_by,total_cents,notes,request_id,request_hash) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, data.personId, person.name, req.user!.id, totalCents, data.notes, data.requestId, requestHash);
      const insertItem = db.prepare('INSERT INTO purchase_items (purchase_id,product_id,product_name,unit_price_cents,quantity,total_cents) VALUES (?,?,?,?,?,?)');
      for (const item of items) insertItem.run(id, item.productId, item.name, item.priceCents, item.quantity, item.total);
      return { purchase: { id, totalCents }, duplicate: false };
    });
    res.status(result.duplicate ? 200 : 201).json(result.purchase);
  });
  app.get('/api/stats', (_req, res) => {
    res.json({
      persons: (db.prepare('SELECT COUNT(*) AS n FROM persons WHERE archived=0').get() as { n: number }).n,
      products: (db.prepare('SELECT COUNT(*) AS n FROM products WHERE active=1').get() as { n: number }).n,
      purchases: (db.prepare('SELECT COUNT(*) AS n FROM purchases').get() as { n: number }).n,
      totalCents: (db.prepare('SELECT COALESCE(SUM(total_cents),0) AS n FROM purchases').get() as { n: number }).n,
    });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API-Endpunkt nicht gefunden.' }));
  if (distDir && existsSync(path.join(distDir, 'index.html'))) {
    app.use(express.static(distDir, { index: false }));
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
  }
  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (res.headersSent) return;
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(' · ') });
    } else if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
    } else if (error instanceof multer.MulterError) {
      res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Das Bild darf maximal 12 MB groß sein.' : 'Ungültiger Upload. Bitte genau ein Bild auswählen.' });
    } else if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      res.status(409).json({ error: 'Dieser Name ist bereits vergeben.' });
    } else if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
      res.status(400).json({ error: 'Die Anfrage enthält ungültiges JSON.' });
    } else if (error instanceof Error && 'status' in error && error.status === 413) {
      res.status(413).json({ error: 'Die Anfrage ist zu groß.' });
    } else {
      console.error('Anfrage fehlgeschlagen:', error);
      res.status(500).json({ error: 'Ein Serverfehler ist aufgetreten. Bitte erneut versuchen; Details stehen im Serverprotokoll.' });
    }
  };
  app.use(errorHandler);
  return app;
}
