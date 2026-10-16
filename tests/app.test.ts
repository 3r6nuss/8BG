import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import request from 'supertest';
import sharp from 'sharp';
import { createApp } from '../server/app.js';
import { openDatabase, type Database } from '../server/database.js';
import { cleanup } from '../server/maintenance.js';

describe('8BG API', () => {
  let dir: string;
  let db: Database;
  let app: ReturnType<typeof createApp>;
  let admin: ReturnType<typeof request.agent>;
  let csrf: string;
  const password = 'a-strong-test-password-2026';
  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), '8bg-test-'));
    db = openDatabase(dir);
    app = createApp({
      db, dataDir: dir, bootstrapToken: 'test-setup-token',
      recognize: async () => 'NAME:\nAlex Sommer\nGEBURTSDATUM:\n2004/08/04',
    });
    admin = request.agent(app);
    const setup = await admin.post('/api/auth/setup').send({ token: 'test-setup-token', username: 'admin', password }).expect(201);
    csrf = setup.body.csrfToken;
  });
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

  async function person(name = 'Alex Sommer', scanId: string | null = null) {
    const result = await admin.post('/api/persons').set('X-CSRF-Token', csrf)
      .send({ name, birthDate: '2004-08-04', phone: '01982', notes: 'Testnotiz', scanId }).expect(201);
    return result.body;
  }
  async function product(name = 'Weizen', priceCents = 72000) {
    const result = await admin.post('/api/products').set('X-CSRF-Token', csrf).send({ name, priceCents }).expect(201);
    return result.body;
  }
  async function member() {
    await admin.post('/api/users').set('X-CSRF-Token', csrf).send({ username: 'team', password, role: 'member' }).expect(201);
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ username: 'team', password }).expect(200);
    return { agent, token: login.body.csrfToken as string };
  }
  async function upload() {
    const png = await sharp({ create: { width: 620, height: 350, channels: 3, background: '#fafafa' } }).png().toBuffer();
    return admin.post('/api/id-scans').set('X-CSRF-Token', csrf).attach('image', png, 'ausweis.png').expect(201);
  }

  it('schützt Daten, Schreibzugriffe und fremde Ursprünge', async () => {
    await request(app).get('/api/persons').expect(401);
    const health = await request(app).get('/api/health').expect(200);
    assert.equal(health.body.service, '8bg');
    assert.equal(health.body.status, 'up');
    assert.equal(health.body.checks.length, 12);
    assert.ok(health.body.checks.every((check: { status: string }) => ['up', 'degraded', 'down'].includes(check.status)));
    assert.ok(!JSON.stringify(health.body).includes(dir));
    await admin.post('/api/products').send({ name: 'Milch', priceCents: 100000 }).expect(403);
    await admin.post('/api/products').set('X-CSRF-Token', csrf).set('Origin', 'https://fremd.example')
      .send({ name: 'Milch', priceCents: 100000 }).expect(403);
    const result = await admin.get('/api/persons').expect(200);
    assert.equal(result.headers['cache-control'], 'no-store');
  });

  it('schützt die Serververwaltungs-Diagnosen mit einem separaten Bearer-Token', async () => {
    const token = 'a'.repeat(64);
    const secured = createApp({ db, dataDir: dir, bootstrapToken: '', healthToken: token });
    const unauthorized = await request(secured).get('/api/health').expect(401);
    assert.deepEqual(unauthorized.body, { ok: false, error: 'Health-Check nicht autorisiert.' });
    await request(secured).get('/api/health').set('Authorization', `Bearer ${'b'.repeat(64)}`).expect(401);
    const health = await request(secured).get('/api/health').set('Authorization', `Bearer ${token}`).expect(200);
    assert.equal(health.body.checks.length, 12);
    assert.ok(!JSON.stringify(health.body).includes(token));
    assert.ok(!JSON.stringify(health.body).includes(dir));
  });

  it('verhindert eine erneute Ersteinrichtung und zu kurze Passwörter', async () => {
    await request(app).post('/api/auth/setup').send({ token: 'test-setup-token', username: 'second', password }).expect(409);
    await request(app).post('/api/auth/setup').send({ token: 'wrong', username: 'second', password }).expect(403);
    await admin.post('/api/users').set('X-CSRF-Token', csrf).send({ username: 'weak', password: 'short' }).expect(400);
    const login = await request(app).post('/api/auth/login').send({ username: 'admin', password }).expect(200);
    assert.match(login.headers['set-cookie'][0], /HttpOnly/);
    assert.match(login.headers['set-cookie'][0], /SameSite=Strict/);
    assert.equal(db.prepare('SELECT password_hash FROM users').get()!.password_hash === password, false);
  });

  it('beschränkt Mitarbeiterrechte, erlaubt aber Personen und Ankäufe', async () => {
    const { agent, token } = await member();
    await agent.get('/api/users').expect(403);
    await agent.post('/api/products').set('X-CSRF-Token', token).send({ name: 'Eier', priceCents: 58000 }).expect(403);
    await agent.post('/api/persons').set('X-CSRF-Token', token).send({ name: 'Team Kontakt' }).expect(201);
    const p = await person(); const item = await product();
    await agent.post('/api/purchases').set('X-CSRF-Token', token).send({
      personId: p.id, requestId: randomUUID(), items: [{ productId: item.id, quantity: 2, unitPriceCents: item.priceCents }],
    }).expect(201);
  });

  it('validiert Personen und Kalenderdaten und speichert Änderungen', async () => {
    await admin.post('/api/persons').set('X-CSRF-Token', csrf).send({ name: 'Alex', birthDate: '2004-02-30' }).expect(400);
    await admin.post('/api/persons').set('X-CSRF-Token', csrf).send({ name: 'Alex', birthDate: '2999-01-01' }).expect(400);
    const p = await person();
    await admin.put(`/api/persons/${p.id}`).set('X-CSRF-Token', csrf)
      .send({ name: 'Alex Neu', birthDate: p.birthDate, phone: '12345', notes: 'Aktualisiert', archived: true }).expect(200);
    const list = await admin.get('/api/persons').expect(200);
    assert.equal(list.body[0].name, 'Alex Neu');
    assert.equal(list.body[0].archived, 1);
  });

  it('rechnet serverseitig in Cent und speichert unveränderliche Preis- und Namensstände', async () => {
    const p = await person(); const wheat = await product('Weizen', 72000); const eggs = await product('Eier', 58001);
    const result = await admin.post('/api/purchases').set('X-CSRF-Token', csrf).send({
      personId: p.id, requestId: randomUUID(), totalCents: 1,
      items: [{ productId: wheat.id, quantity: 3, unitPriceCents: 72000 }, { productId: eggs.id, quantity: 2, unitPriceCents: 58001 }],
    }).expect(201);
    assert.equal(result.body.totalCents, 332002);
    await admin.put(`/api/products/${wheat.id}`).set('X-CSRF-Token', csrf).send({ name: 'Neuer Weizen', priceCents: 5, active: false }).expect(200);
    await admin.put(`/api/persons/${p.id}`).set('X-CSRF-Token', csrf).send({ name: 'Neuer Name', archived: false }).expect(200);
    const detail = await admin.get(`/api/purchases/${result.body.id}`).expect(200);
    assert.equal(detail.body.personName, 'Alex Sommer');
    assert.equal(detail.body.items[0].productName, 'Weizen');
    assert.equal(detail.body.items[0].unitPriceCents, 72000);
    assert.equal(detail.body.totalCents, 332002);
    const stats = await admin.get('/api/stats').expect(200);
    assert.equal(stats.body.totalCents, 332002);
    assert.equal(stats.body.purchases, 1);
    assert.equal(stats.body.purchaseCount, 1);
    assert.equal(stats.body.saleCount, 0);
    assert.equal(stats.body.purchaseTotalCents, 332002);
    assert.equal(stats.body.saleTotalCents, 0);
    await admin.delete(`/api/persons/${p.id}`).set('X-CSRF-Token', csrf).expect(409);
  });

  it('berechnet Verkäufe mit Verkaufspreisen und trennt ihre Einnahmen von Auszahlungen', async () => {
    const p = await person();
    const created = await admin.post('/api/products').set('X-CSRF-Token', csrf).send({
      name: 'Äpfel', buyPriceCents: 2000, sellPriceCents: 3750,
    }).expect(201);
    assert.equal(created.body.buyPriceCents, 2000);
    assert.equal(created.body.sellPriceCents, 3750);
    assert.equal(created.body.active, 1);
    const item = created.body;
    const sold = await admin.post('/api/purchases').set('X-CSRF-Token', csrf).send({
      direction: 'sell', personId: p.id, requestId: randomUUID(),
      items: [{ productId: item.id, quantity: 4, unitPriceCents: item.sellPriceCents }],
    }).expect(201);
    assert.equal(sold.body.totalCents, 15000);
    const detail = await admin.get(`/api/purchases/${sold.body.id}`).expect(200);
    assert.equal(detail.body.direction, 'sell');
    assert.equal(detail.body.items[0].unitPriceCents, 3750);
    await admin.get('/api/purchases?direction=sell').expect(200)
      .then(result => { assert.equal(result.body.total, 1); assert.equal(result.body.items[0].direction, 'sell'); });
    await admin.get('/api/purchases?direction=buy').expect(200)
      .then(result => { assert.equal(result.body.total, 0); });
    await admin.get('/api/purchases?direction=all').expect(200)
      .then(result => { assert.equal(result.body.total, 1); });
    await admin.get('/api/purchases?direction=unknown').expect(400);
    const stats = await admin.get('/api/stats').expect(200);
    assert.equal(stats.body.purchaseCount, 0);
    assert.equal(stats.body.saleCount, 1);
    assert.equal(stats.body.purchaseTotalCents, 0);
    assert.equal(stats.body.saleTotalCents, 15000);
  });

  it('speichert wiederholte Requests nur einmal und erkennt abweichende Wiederholungen', async () => {
    const p = await person(); const item = await product();
    const body = { personId: p.id, requestId: randomUUID(), items: [{ productId: item.id, quantity: 2, unitPriceCents: item.priceCents }] };
    const first = await admin.post('/api/purchases').set('X-CSRF-Token', csrf).send(body).expect(201);
    const second = await admin.post('/api/purchases').set('X-CSRF-Token', csrf).send(body).expect(200);
    assert.equal(first.body.id, second.body.id);
    await admin.post('/api/purchases').set('X-CSRF-Token', csrf).send({ ...body, notes: 'Geändert' }).expect(409);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM purchases').get()!.n, 1);
  });

  it('weist ungültige Mengen, doppelte Produkte und ungültige Buchungspreise zurück', async () => {
    const p = await person(); const item = await product();
    for (const quantity of [0, -1, 1.5, 1000001]) {
      await admin.post('/api/purchases').set('X-CSRF-Token', csrf).send({
        personId: p.id, requestId: randomUUID(), items: [{ productId: item.id, quantity, unitPriceCents: item.priceCents }],
      }).expect(400);
    }
    const line = { productId: item.id, quantity: 1, unitPriceCents: item.priceCents };
    await admin.post('/api/purchases').set('X-CSRF-Token', csrf).send({ personId: p.id, requestId: randomUUID(), items: [line, line] }).expect(400);
    for (const unitPriceCents of [-1, 1.5, 100000001, '72000', null]) {
      await admin.post('/api/purchases').set('X-CSRF-Token', csrf).send({
        personId: p.id, requestId: randomUUID(), items: [{ ...line, unitPriceCents }],
      }).expect(400);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM purchases').get()!.n, 0);
  });

  it('erlaubt individuelle Preise für Mitarbeiter in beiden Richtungen ohne Stammdaten zu verändern', async () => {
    const p = await person();
    const item = await product();
    const { agent, token } = await member();
    for (const direction of ['buy', 'sell']) {
      const body = {
        direction, personId: p.id, requestId: randomUUID(),
        items: [{ productId: item.id, quantity: 3, unitPriceCents: 12345 }],
      };
      const result = await agent.post('/api/purchases').set('X-CSRF-Token', token).send(body).expect(201);
      assert.equal(result.body.totalCents, 37035);
      const repeat = await agent.post('/api/purchases').set('X-CSRF-Token', token).send(body).expect(200);
      assert.equal(repeat.body.id, result.body.id);
      await agent.post('/api/purchases').set('X-CSRF-Token', token)
        .send({ ...body, items: [{ ...body.items[0], unitPriceCents: 12346 }] }).expect(409);
      const detail = await agent.get(`/api/purchases/${result.body.id}`).expect(200);
      assert.equal(detail.body.direction, direction);
      assert.equal(detail.body.items[0].unitPriceCents, 12345);
      assert.equal(detail.body.items[0].totalCents, 37035);
    }
    const products = await agent.get('/api/products').expect(200);
    assert.equal(products.body[0].buyPriceCents, 72000);
    assert.equal(products.body[0].sellPriceCents, 72000);
    await admin.put(`/api/products/${item.id}`).set('X-CSRF-Token', csrf)
      .send({ name: item.name, buyPriceCents: 80000, sellPriceCents: 90000, active: true }).expect(200);
    const zero = await agent.post('/api/purchases').set('X-CSRF-Token', token).send({
      direction: 'sell', personId: p.id, requestId: randomUUID(),
      items: [{ productId: item.id, quantity: 1, unitPriceCents: 0 }],
    }).expect(201);
    assert.equal(zero.body.totalCents, 0);
    const stats = await agent.get('/api/stats').expect(200);
    assert.equal(stats.body.purchaseTotalCents, 37035);
    assert.equal(stats.body.saleTotalCents, 37035);
  });

  it('weist inaktive Produkte, archivierte Personen und überhöhte Beträge zurück', async () => {
    const p = await person(); const item = await product('Teuer', 100000000);
    const body = { personId: p.id, requestId: randomUUID(), items: [{ productId: item.id, quantity: 1000000, unitPriceCents: item.priceCents }] };
    await admin.post('/api/purchases').set('X-CSRF-Token', csrf).send(body).expect(400);
    await admin.put(`/api/products/${item.id}`).set('X-CSRF-Token', csrf).send({ name: item.name, priceCents: item.priceCents, active: false }).expect(200);
    await admin.post('/api/purchases').set('X-CSRF-Token', csrf).send({ ...body, items: [{ ...body.items[0], quantity: 1 }] }).expect(409);
    await admin.put(`/api/persons/${p.id}`).set('X-CSRF-Token', csrf).send({ name: p.name, archived: true }).expect(200);
    await admin.post('/api/purchases').set('X-CSRF-Token', csrf).send(body).expect(400);
  });

  it('prüft Produktpreise und eindeutige Namen', async () => {
    await product();
    await admin.post('/api/products').set('X-CSRF-Token', csrf).send({ name: 'weizen', priceCents: 1 }).expect(409);
    for (const priceCents of [-1, 1.2, 100000001, '72000']) {
      await admin.post('/api/products').set('X-CSRF-Token', csrf).send({ name: 'Ungültig', priceCents }).expect(400);
    }
  });

  it('konvertiert Bilder wirklich zu WebP, liest Felder aus und schützt Originale', async () => {
    const result = await upload();
    assert.deepEqual(result.body.fields, { name: 'Alex Sommer', birthDate: '2004-08-04' });
    const files = readdirSync(path.join(dir, 'uploads'));
    assert.equal(files.length, 1); assert.match(files[0], /\.webp$/);
    const image = await admin.get(result.body.imageUrl).expect(200).expect('Content-Type', /image\/webp/);
    assert.equal((await sharp(image.body).metadata()).format, 'webp');
    await request(app).get(result.body.imageUrl).expect(401);
    const { agent } = await member();
    await agent.get(result.body.imageUrl).expect(404);
    const p = await person('Alex Sommer', result.body.scanId);
    await agent.get(result.body.imageUrl).expect(200);
    await admin.delete(`/api/id-scans/${result.body.scanId}`).set('X-CSRF-Token', csrf).expect(409);
    await admin.put(`/api/persons/${p.id}`).set('X-CSRF-Token', csrf).send({ name: p.name, scanId: null }).expect(200);
    assert.equal(readdirSync(path.join(dir, 'uploads')).length, 0);
    await admin.get(result.body.imageUrl).expect(404);
  });

  it('weist falsche Bildinhalte zurück, auch bei gefälschter Dateiendung', async () => {
    await admin.post('/api/id-scans').set('X-CSRF-Token', csrf).attach('image', Buffer.from('<script>bad</script>'), 'bild.png').expect(400);
    assert.equal(readdirSync(path.join(dir, 'uploads')).length, 0);
  });

  it('weist Uploads oberhalb des 12-MB-Limits zurück', async () => {
    const result = await admin.post('/api/id-scans').set('X-CSRF-Token', csrf)
      .attach('image', Buffer.alloc(12 * 1024 * 1024 + 1), 'gross.png').expect(400);
    assert.match(result.body.error, /12 MB/);
    assert.equal(readdirSync(path.join(dir, 'uploads')).length, 0);
  });

  it('meldet OCR-Ausfälle ausdrücklich und behält das gültige WebP für manuelle Eingaben', async () => {
    const failing = createApp({ db, dataDir: dir, bootstrapToken: '', recognize: async () => { throw new Error('Test: OCR unavailable'); } });
    const agent = request.agent(failing);
    const login = await agent.post('/api/auth/login').send({ username: 'admin', password }).expect(200);
    const png = await sharp({ create: { width: 100, height: 60, channels: 3, background: 'white' } }).png().toBuffer();
    const result = await agent.post('/api/id-scans').set('X-CSRF-Token', login.body.csrfToken).attach('image', png, 'bild.png').expect(201);
    assert.match(result.body.warning, /fehlgeschlagen/);
    assert.deepEqual(result.body.fields, { name: '', birthDate: '' });
    await agent.get(result.body.imageUrl).expect(200);
  });

  it('bereinigt nur abgebrochene, mindestens 24 Stunden alte Uploads', async () => {
    const linked = await upload(); await person('Alex Sommer', linked.body.scanId);
    const stale = await upload();
    db.prepare("UPDATE scans SET created_at='2000-01-01T00:00:00.000Z'").run();
    cleanup(db, dir);
    await admin.get(linked.body.imageUrl).expect(200);
    await admin.get(stale.body.imageUrl).expect(404);
    assert.equal(readdirSync(path.join(dir, 'uploads')).length, 1);
  });

  it('meldet ab und entzieht beim Passwortwechsel alten Sitzungen den Zugriff', async () => {
    const other = request.agent(app);
    await other.post('/api/auth/login').send({ username: 'admin', password }).expect(200);
    const result = await admin.put('/api/auth/password').set('X-CSRF-Token', csrf)
      .send({ currentPassword: password, password: 'new-strong-test-password' }).expect(200);
    await other.get('/api/persons').expect(401);
    await admin.get('/api/persons').expect(200);
    await admin.post('/api/auth/logout').set('X-CSRF-Token', result.body.csrfToken).expect(204);
    await admin.get('/api/persons').expect(401);
  });

  it('behält Daten und Sitzungen nach erneutem Öffnen der Datenbank', async () => {
    const p = await person();
    db.close(); db = openDatabase(dir);
    const restarted = createApp({ db, dataDir: dir, bootstrapToken: 'new-token' });
    assert.equal(db.prepare('SELECT name FROM persons WHERE id=?').get(p.id)!.name, 'Alex Sommer');
    await request(restarted).get('/api/auth/status').expect(200, { needsSetup: false });
    const rows = db.prepare('SELECT COUNT(*) AS n FROM sessions').get();
    assert.equal(rows!.n, 1);
  });

  it('migriert bestehende Datenbanken und übernimmt alte Preise als sicheren Startwert für Verkäufe', () => {
    const legacyDir = mkdtempSync(path.join(tmpdir(), '8bg-legacy-'));
    const legacy = openDatabase(legacyDir);
    try {
      const userId = randomUUID();
      const personId = randomUUID();
      const productId = randomUUID();
      const purchaseId = randomUUID();
      legacy.prepare('INSERT INTO users (id,username,password_hash,role) VALUES (?,?,?,?)')
        .run(userId, 'legacy', 'unused', 'admin');
      legacy.prepare('INSERT INTO persons (id,name) VALUES (?,?)').run(personId, 'Historische Person');
      legacy.prepare('INSERT INTO products (id,name,price_cents,sale_price_cents) VALUES (?,?,?,?)')
        .run(productId, 'Historischer Weizen', 72000, 81000);
      legacy.prepare(`INSERT INTO purchases
        (id,person_id,person_name,created_by,direction,total_cents,request_id,request_hash) VALUES (?,?,?,?,?,?,?,?)`)
        .run(purchaseId, personId, 'Historische Person', userId, 'buy', 72000, randomUUID(), 'legacy');
      legacy.exec('DROP INDEX idx_purchases_direction_created');
      legacy.exec('ALTER TABLE products DROP COLUMN sale_price_cents');
      legacy.exec('ALTER TABLE purchases DROP COLUMN direction');
      legacy.close();
      const migrated = openDatabase(legacyDir);
      try {
        assert.equal((migrated.prepare('SELECT sale_price_cents AS value FROM products WHERE id=?').get(productId) as { value: number }).value, 72000);
        assert.equal((migrated.prepare('SELECT direction FROM purchases WHERE id=?').get(purchaseId) as { direction: string }).direction, 'buy');
      } finally { migrated.close(); }
    } finally {
      try { legacy.close(); } catch { /* The connection is already closed after migration. */ }
      rmSync(legacyDir, { recursive: true, force: true });
    }
  });
});
