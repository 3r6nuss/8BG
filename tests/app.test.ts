import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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
    await admin.post('/api/products').send({ name: 'Milch', priceCents: 100000 }).expect(403);
    await admin.post('/api/products').set('X-CSRF-Token', csrf).set('Origin', 'https://fremd.example')
      .send({ name: 'Milch', priceCents: 100000 }).expect(403);
    const result = await admin.get('/api/persons').expect(200);
    assert.equal(result.headers['cache-control'], 'no-store');
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
    await admin.delete(`/api/persons/${p.id}`).set('X-CSRF-Token', csrf).expect(409);
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

  it('weist ungültige Mengen, doppelte Produkte und geänderte Preise zurück', async () => {
    const p = await person(); const item = await product();
    for (const quantity of [0, -1, 1.5, 1000001]) {
      await admin.post('/api/purchases').set('X-CSRF-Token', csrf).send({
        personId: p.id, requestId: randomUUID(), items: [{ productId: item.id, quantity, unitPriceCents: item.priceCents }],
      }).expect(400);
    }
    const line = { productId: item.id, quantity: 1, unitPriceCents: item.priceCents };
    await admin.post('/api/purchases').set('X-CSRF-Token', csrf).send({ personId: p.id, requestId: randomUUID(), items: [line, line] }).expect(400);
    await admin.post('/api/purchases').set('X-CSRF-Token', csrf).send({ personId: p.id, requestId: randomUUID(), items: [{ ...line, unitPriceCents: 1 }] }).expect(409);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM purchases').get()!.n, 0);
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
});
