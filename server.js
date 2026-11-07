'use strict';

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || 'development';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const requiredInProduction = ['SESSION_SECRET', 'SETUP_KEY', 'HEALTH_TOKEN'];
if (NODE_ENV === 'production') {
  const missing = requiredInProduction.filter(k => !process.env[k] || process.env[k].length < 32);
  if (missing.length) {
    console.error(`Fehlende oder zu kurze Produktions-Secrets: ${missing.join(', ')} (mindestens 32 Zeichen).`);
    process.exit(1);
  }
}
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(48).toString('hex');

const db = new Database(path.join(DATA_DIR, 'grimz.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('owner','admin','manager','staff','reader')),
 permissions TEXT NOT NULL DEFAULT '[]',
 active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
 sid TEXT PRIMARY KEY,
 sess TEXT NOT NULL,
 expire INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expire_idx ON sessions(expire);
CREATE TABLE IF NOT EXISTS audit_log (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER,
 username TEXT NOT NULL,
 action TEXT NOT NULL,
 section TEXT NOT NULL,
 record_id INTEGER,
 details TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);
const usersSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get().sql;
if (!usersSchema.includes("'admin'")) {
  db.transaction(() => {
    db.exec(`
      ALTER TABLE users RENAME TO users_legacy;
      CREATE TABLE users (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       username TEXT NOT NULL UNIQUE COLLATE NOCASE,
       password_hash TEXT NOT NULL,
       role TEXT NOT NULL CHECK(role IN ('owner','admin','manager','staff','reader')),
       permissions TEXT NOT NULL DEFAULT '[]',
       active INTEGER NOT NULL DEFAULT 1,
       created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO users(id,username,password_hash,role,permissions,active,created_at)
        SELECT id,username,password_hash,role,permissions,active,created_at FROM users_legacy;
      DROP TABLE users_legacy;
    `);
  })();
}

const sections = {
 members: {
  table:'members', label:'Member', permission:'members',
  fields:[['name','Name',true],['member_number','Mitgliedsnummer',false],['status','Status',true],['joined','Beitrittsdatum',false],['notes','Notizen',false]],
 },
 dues: {
  table:'dues', label:'Abgaben', permission:'dues',
  fields:[['member','Member',true],['amount','Betrag',true],['due_date','Fällig am',false],['status','Status',true],['paid_date','Bezahlt am',false],['notes','Notizen',false]],
 },
 warehouse: {
  table:'warehouse', label:'Lager', permission:'warehouse',
  fields:[['item','Artikel',true],['category','Kategorie',false],['quantity','Menge',true],['unit','Einheit',true],['location','Lagerort',false],['notes','Notizen',false]],
 },
 safe: {
  table:'safe_transactions', label:'Tresor', permission:'safe',
  fields:[['movement','Bewegung',true],['amount','Betrag',true],['date','Datum',true],['reference','Referenz',false],['notes','Notizen',false]],
 },
 staff: {
  table:'staff', label:'Zivis', permission:'staff',
  fields:[['name','Name',true],['assignment','Aufgabe',false],['status','Status',true],['phone','Kontakt',false],['notes','Notizen',false]],
 },
 products: {
  table:'products', label:'Produkt-Preisliste', permission:'products',
  fields:[['name','Produktname',true],['category','Kategorie',false],['price','Preis',false],['unit','Einheit',true],['stock','Eigener Bestand',false],['notes','Notizen',false]],
 },
 fams: {
  table:'fam_contacts', label:'Kontakte: Fams', permission:'fams',
  fields:[['contact_name','Ansprechpartner',true],['fam_name','Fam / Gruppe',true],['role','Funktion',false],['discord','Discord / Kontakt',false],['phone','Telefon',false],['notes','Notizen',false]],
 },
 civilians: {
  table:'civilian_contacts', label:'Kontakte: Zivilisten', permission:'civilians',
  fields:[['name','Name',true],['role','Funktion',false],['phone','Telefon',false],['email','E-Mail',false],['notes','Notizen',false]],
 }
};
for (const cfg of Object.values(sections)) {
  const cols = cfg.fields.map(([key]) => `"${key}" TEXT NOT NULL DEFAULT ''`).join(',\n');
  db.exec(`CREATE TABLE IF NOT EXISTS "${cfg.table}" (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ${cols},
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
}
const productCount = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
if (productCount === 0) {
  const insert = db.prepare(`INSERT INTO products(name,category,price,unit,stock,notes) VALUES(?,?,?,?,?,?)`);
  const seed = db.transaction(() => {
    for (let i=1;i<=32;i++) {
      insert.run(`Produkt ${String(i).padStart(2,'0')}`, 'Noch zuordnen', '', 'Stück', '0', 'Produktdaten bitte ergänzen');
    }
  });
  seed();
}

class SQLiteSessionStore extends session.Store {
  get(sid, cb) {
    try {
      const row = db.prepare('SELECT sess, expire FROM sessions WHERE sid=?').get(sid);
      if (!row) return cb(null, null);
      if (row.expire <= Date.now()) {
        db.prepare('DELETE FROM sessions WHERE sid=?').run(sid);
        return cb(null, null);
      }
      cb(null, JSON.parse(row.sess));
    } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try {
      const expire = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 8*60*60*1000;
      db.prepare(`INSERT INTO sessions(sid,sess,expire) VALUES(?,?,?)
        ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess, expire=excluded.expire`)
        .run(sid, JSON.stringify(sess), expire);
      if (cb) cb(null);
    } catch (e) { if (cb) cb(e); }
  }
  destroy(sid, cb) {
    try { db.prepare('DELETE FROM sessions WHERE sid=?').run(sid); if (cb) cb(null); }
    catch (e) { if (cb) cb(e); }
  }
  touch(sid, sess, cb) { this.set(sid, sess, cb); }
}
const app = express();
if (NODE_ENV === 'production') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:["'self'"], scriptSrc:["'self'"], styleSrc:["'self'","'unsafe-inline'"],
      imgSrc:["'self'","data:"], connectSrc:["'self'"], objectSrc:["'none'"],
      baseUri:["'self'"], frameAncestors:["'none'"], formAction:["'self'"]
    }
  },
  referrerPolicy:{policy:'no-referrer'}
}));
app.use(express.json({limit:'30kb'}));
app.use(session({
  name:'grimz.sid',
  secret:SESSION_SECRET,
  store:new SQLiteSessionStore(),
  resave:false,
  saveUninitialized:false,
  rolling:true,
  cookie:{httpOnly:true, secure:NODE_ENV==='production', sameSite:'lax', maxAge:8*60*60*1000}
}));

const loginLimiter = rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:true,legacyHeaders:false,message:{error:'Zu viele Versuche. Bitte später erneut versuchen.'}});
const setupLimiter = rateLimit({windowMs:60*60*1000,limit:5,standardHeaders:true,legacyHeaders:false});
const sectionsList = Object.keys(sections);
const allPermissions = sectionsList;
const roleLabels = {owner:'Inhaber',admin:'Administrator',manager:'Verwalter',staff:'Mitarbeiter',reader:'Leser'};
function isAdmin(user){ return user.role==='owner'||user.role==='admin'; }

function safeEqual(a,b) {
  const x=Buffer.from(String(a||'')), y=Buffer.from(String(b||''));
  return x.length===y.length && crypto.timingSafeEqual(x,y);
}
function hasUsers(){ return db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0; }
function healthReport() {
  const checks=[];
  const add=(id,name,status,message=null,metrics=undefined)=>
    checks.push({id,name,status,message,...(metrics?{metrics}:{})});
  const uptimeSeconds=Math.floor(process.uptime());
  add('application','8BG-Anwendung','up',null,{uptimeSeconds});
  const nodeMajor=Number(process.versions.node.split('.')[0]);
  add('node_runtime','Node.js-Laufzeit',nodeMajor>=20?'up':'degraded',
    nodeMajor>=20?null:'Node.js 20 oder neuer wird empfohlen.',{majorVersion:nodeMajor});
  try {
    db.prepare('SELECT 1 AS connected').get();
    add('database','SQLite-Datenbank','up');
  } catch {
    add('database','SQLite-Datenbank','down','Datenbankabfrage fehlgeschlagen.');
  }
  try {
    const requiredTables=['users','sessions','audit_log',...Object.values(sections).map(cfg=>cfg.table)];
    const existing=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
    const missing=requiredTables.filter(table=>!existing.has(table));
    add('database_schema','Datenbankschema',missing.length?'down':'up',
      missing.length?'Erforderliche Anwendungsdaten fehlen.':null);
  } catch {
    add('database_schema','Datenbankschema','down','Datenbankschema konnte nicht geprüft werden.');
  }
  let integrity='up';
  try {
    const result=db.prepare('PRAGMA quick_check(1)').get();
    if(result?.quick_check!=='ok') integrity='down';
  } catch {
    integrity='down';
  }
  add('database_integrity','Datenbankintegrität',integrity,
    integrity==='up'?null:'Integritätsprüfung fehlgeschlagen.');
  try {
    fs.accessSync(DATA_DIR,fs.constants.R_OK|fs.constants.W_OK);
    add('data_directory','Datenspeicher','up');
  } catch {
    add('data_directory','Datenspeicher','down','Speicher ist nicht les- und beschreibbar.');
  }
  try {
    const disk=fs.statfsSync(DATA_DIR);
    const availableMiB=Math.floor((disk.bavail*disk.bsize)/(1024*1024));
    const status=availableMiB<128?'down':availableMiB<512?'degraded':'up';
    add('disk_space','Freier Speicherplatz',status,
      status==='down'?'Kritisch wenig freier Speicherplatz.':status==='degraded'?'Freier Speicherplatz wird knapp.':null,
      {availableMiB,totalMiB:Math.floor((disk.blocks*disk.bsize)/(1024*1024))});
  } catch {
    add('disk_space','Freier Speicherplatz','degraded','Speicherplatz konnte nicht abgefragt werden.');
  }
  try {
    const expired=db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE expire<=?').get(Date.now()).count;
    const status=expired>=10000?'down':expired>=1000?'degraded':'up';
    add('session_backlog','Abgelaufene Sitzungen',status,
      status==='down'?'Sehr viele abgelaufene Sitzungen warten auf Bereinigung.':
      status==='degraded'?'Abgelaufene Sitzungen warten auf Bereinigung.':null,
      {expiredSessions:expired});
  } catch {
    add('session_backlog','Sitzungsbereinigung','degraded','Sitzungsbereinigung konnte nicht geprüft werden.');
  }
  const status=checks.some(item=>item.status==='down')?'down':
    checks.some(item=>item.status==='degraded')?'degraded':'up';
  return {ok:status!=='down',service:'8bg',status,checkedAt:new Date().toISOString(),uptimeSeconds,checks};
}
function log(user, action, section, recordId=null, details='') {
  db.prepare('INSERT INTO audit_log(user_id,username,action,section,record_id,details) VALUES(?,?,?,?,?,?)')
    .run(user.id,user.username,action,section,recordId, String(details).slice(0,500));
}
function publicUser(u) {
  return {id:u.id,username:u.username,role:u.role,roleLabel:roleLabels[u.role],permissions:isAdmin(u)?allPermissions:JSON.parse(u.permissions),active:!!u.active};
}
function auth(req,res,next){
  if(!req.session.userId) return res.status(401).json({error:'Bitte anmelden.'});
  const u=db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(req.session.userId);
  if(!u){ req.session.destroy(()=>{}); return res.status(401).json({error:'Zugang deaktiviert oder Sitzung abgelaufen.'}); }
  next();
}
function currentUser(req){ return db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(req.session.userId); }
function requireAdmin(req,res,next){ const u=currentUser(req); if(!u||!isAdmin(u)) return res.status(403).json({error:'Nur ein Administrator darf diesen Bereich verwenden.'}); req.user=u; next(); }
function requirePermission(permission, write=false) {
  return (req,res,next)=>{
    const u=currentUser(req);
    if(!u) return res.status(401).json({error:'Bitte anmelden.'});
    const perms=isAdmin(u)?allPermissions:JSON.parse(u.permissions);
    if(!perms.includes(permission)) return res.status(403).json({error:'Keine Berechtigung für diesen Bereich.'});
    if(write && u.role==='reader') return res.status(403).json({error:'Dieser Zugang ist nur leseberechtigt.'});
    req.user=u; next();
  };
}
function csrf(req,res,next) {
  const token=req.get('x-csrf-token');
  if(!token || !req.session.csrfToken || !safeEqual(token,req.session.csrfToken))
    return res.status(403).json({error:'Sicherheitsprüfung fehlgeschlagen. Bitte Seite neu laden.'});
  const origin=req.get('origin');
  if(origin) {
    try { if(new URL(origin).host!==req.get('host')) return res.status(403).json({error:'Ungültige Herkunft.'}); }
    catch { return res.status(403).json({error:'Ungültige Herkunft.'}); }
  }
  next();
}
function cleanFields(cfg,body) {
  const out={};
  for (const [key,label,required] of cfg.fields) {
    const value=body[key]===undefined?'':String(body[key]).trim();
    if(required && !value) throw new Error(`${label} ist erforderlich.`);
    if(value.length>2000) throw new Error(`${label} ist zu lang.`);
    if(['amount','price','quantity','stock'].includes(key) && value && !/^-?\d{1,10}([,.]\d{1,2})?$/.test(value))
      throw new Error(`${label} muss eine gültige Zahl sein.`);
    out[key]=value;
  }
  return out;
}
function recordDbSection(req,res,next) {
  const cfg=sections[req.params.section];
  if(!cfg) return res.status(404).json({error:'Bereich nicht gefunden.'});
  req.cfg=cfg; next();
}

app.get('/api/setup/status',(req,res)=>res.json({setupRequired:!hasUsers(),setupAvailable:!!process.env.SETUP_KEY}));
app.get('/api/health',(req,res)=>{
  const token=process.env.HEALTH_TOKEN;
  if(!token || !safeEqual(req.get('authorization'),`Bearer ${token}`))
    return res.status(403).json({error:'Nicht autorisiert.'});
  const report=healthReport();
  res.status(report.ok?200:503).json(report);
});
app.post('/api/setup',setupLimiter,(req,res)=>{
  if(hasUsers()) return res.status(403).json({error:'Die Ersteinrichtung wurde bereits abgeschlossen.'});
  if(!process.env.SETUP_KEY || !safeEqual(req.body.setupKey,process.env.SETUP_KEY)) return res.status(403).json({error:'Einrichtungsschlüssel ist falsch.'});
  const username=String(req.body.username||'').trim();
  const password=String(req.body.password||'');
  if(!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) return res.status(400).json({error:'Benutzername: 3–32 Zeichen, nur Buchstaben, Zahlen, Punkt, _ und -.'});
  if(password.length<12) return res.status(400).json({error:'Das Passwort muss mindestens 12 Zeichen haben.'});
  try {
    const hash=bcrypt.hashSync(password,12);
    db.prepare("INSERT INTO users(username,password_hash,role,permissions) VALUES(?,?,'owner',?)").run(username,hash,JSON.stringify(allPermissions));
    res.json({ok:true});
  } catch(e){ res.status(400).json({error:'Benutzer konnte nicht angelegt werden. Benutzername eventuell vergeben.'}); }
});
app.post('/api/login',loginLimiter,(req,res)=>{
  const username=String(req.body.username||'').trim();
  const password=String(req.body.password||'');
  const user=db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get(username);
  if(!user||!user.active||!bcrypt.compareSync(password,user.password_hash)) return res.status(401).json({error:'Benutzername oder Passwort ist falsch.'});
  req.session.regenerate(err=>{
    if(err) return res.status(500).json({error:'Anmeldung fehlgeschlagen.'});
    req.session.userId=user.id;
    req.session.csrfToken=crypto.randomBytes(32).toString('hex');
    req.session.save(e=>{
      if(e) return res.status(500).json({error:'Sitzung konnte nicht gespeichert werden.'});
      log(user,'login','auth',null,'Anmeldung');
      res.json({ok:true});
    });
  });
});
app.post('/api/logout',auth,csrf,(req,res)=>{
  const u=currentUser(req); if(u) log(u,'logout','auth',null,'Abmeldung');
  req.session.destroy(()=>{res.clearCookie('grimz.sid');res.json({ok:true});});
});
app.get('/api/me',auth,(req,res)=>{
  const u=currentUser(req); if(!u) return res.status(401).json({error:'Sitzung abgelaufen.'});
  if(!req.session.csrfToken) req.session.csrfToken=crypto.randomBytes(32).toString('hex');
  res.json({user:publicUser(u),csrfToken:req.session.csrfToken});
});
app.get('/api/dashboard',auth,(req,res)=>{
  const u=currentUser(req); const perms=isAdmin(u)?allPermissions:JSON.parse(u.permissions);
  const counts={};
  for(const [section,cfg] of Object.entries(sections)) if(perms.includes(section)) counts[section]=db.prepare(`SELECT COUNT(*) AS n FROM "${cfg.table}"`).get().n;
  if(perms.includes('dues')) counts.openDues=db.prepare("SELECT COUNT(*) AS n FROM dues WHERE status='Offen'").get().n;
  res.json({counts});
});

app.get('/api/data/:section',auth,recordDbSection,(req,res,next)=>{
  const cfg=req.cfg; const mw=requirePermission(cfg.permission,false);
  mw(req,res,()=>{
    const rows=db.prepare(`SELECT * FROM "${cfg.table}" ORDER BY id DESC LIMIT 1000`).all();
    res.json(rows);
  });
});
app.post('/api/data/:section',auth,csrf,recordDbSection,(req,res)=>{
  const cfg=req.cfg; const perms=req.user?null:null;
  const u=currentUser(req); const allowed=u && (isAdmin(u)||JSON.parse(u.permissions).includes(cfg.permission));
  if(!allowed||u.role==='reader') return res.status(403).json({error:'Keine Schreibberechtigung.'});
  try {
    const data=cleanFields(cfg,req.body);
    const keys=Object.keys(data); const marks=keys.map(()=>'?').join(',');
    const info=db.prepare(`INSERT INTO "${cfg.table}"(${keys.map(k=>`"${k}"`).join(',')},created_by) VALUES(${marks},?)`).run(...keys.map(k=>data[k]),u.id);
    log(u,'create',req.params.section,info.lastInsertRowid,`Neuer Eintrag`);
    res.status(201).json({id:info.lastInsertRowid});
  } catch(e){res.status(400).json({error:e.message||'Eingabe ungültig.'});}
});
app.put('/api/data/:section/:id',auth,csrf,recordDbSection,(req,res)=>{
  const cfg=req.cfg,u=currentUser(req);
  const allowed=u&&(isAdmin(u)||JSON.parse(u.permissions).includes(cfg.permission));
  if(!allowed||u.role==='reader') return res.status(403).json({error:'Keine Schreibberechtigung.'});
  try {
    const data=cleanFields(cfg,req.body), keys=Object.keys(data);
    const result=db.prepare(`UPDATE "${cfg.table}" SET ${keys.map(k=>`"${k}"=?`).join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...keys.map(k=>data[k]),Number(req.params.id));
    if(!result.changes) return res.status(404).json({error:'Eintrag nicht gefunden.'});
    log(u,'update',req.params.section,Number(req.params.id),'Eintrag geändert');
    res.json({ok:true});
  } catch(e){res.status(400).json({error:e.message||'Eingabe ungültig.'});}
});
app.delete('/api/data/:section/:id',auth,csrf,recordDbSection,(req,res)=>{
  const cfg=req.cfg,u=currentUser(req);
  const allowed=u&&(isAdmin(u)||JSON.parse(u.permissions).includes(cfg.permission));
  if(!allowed||u.role==='reader') return res.status(403).json({error:'Keine Schreibberechtigung.'});
  const id=Number(req.params.id);
  const result=db.prepare(`DELETE FROM "${cfg.table}" WHERE id=?`).run(id);
  if(!result.changes) return res.status(404).json({error:'Eintrag nicht gefunden.'});
  log(u,'delete',req.params.section,id,'Eintrag gelöscht');
  res.json({ok:true});
});

app.get('/api/users',auth,requireAdmin,(req,res)=>{
  res.json(db.prepare('SELECT id,username,role,permissions,active,created_at FROM users ORDER BY id').all().map(u=>({...u,permissions:isAdmin(u)?allPermissions:JSON.parse(u.permissions),roleLabel:roleLabels[u.role],active:!!u.active})));
});
app.post('/api/users',auth,csrf,requireAdmin,(req,res)=>{
  const username=String(req.body.username||'').trim(), password=String(req.body.password||''), role=String(req.body.role||'staff');
  const permissions=role==='admin'?allPermissions:Array.isArray(req.body.permissions)?req.body.permissions.filter(p=>allPermissions.includes(p)):[];
  if(!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) return res.status(400).json({error:'Ungültiger Benutzername.'});
  if(password.length<12) return res.status(400).json({error:'Passwort muss mindestens 12 Zeichen haben.'});
  if(!['admin','manager','staff','reader'].includes(role)) return res.status(400).json({error:'Ungültige Rolle.'});
  try {
    const info=db.prepare('INSERT INTO users(username,password_hash,role,permissions) VALUES(?,?,?,?)')
      .run(username,bcrypt.hashSync(password,12),role,JSON.stringify(permissions));
    log(req.user,'create','users',info.lastInsertRowid,`Benutzer ${username} erstellt`);
    res.status(201).json({id:info.lastInsertRowid});
  } catch(e){res.status(400).json({error:'Benutzername ist bereits vergeben.'});}
});
app.patch('/api/users/:id',auth,csrf,requireAdmin,(req,res)=>{
  const id=Number(req.params.id);
  if(id===req.user.id) return res.status(400).json({error:'Den eigenen Zugang kannst du hier nicht ändern.'});
  const target=db.prepare("SELECT id,role FROM users WHERE id=? AND role<>'owner'").get(id);
  if(!target) return res.status(404).json({error:'Benutzer nicht gefunden.'});
  const updates=[]; const values=[];
  if(req.body.active!==undefined){updates.push('active=?');values.push(req.body.active?1:0);}
  const role=req.body.role===undefined?target.role:String(req.body.role);
  if(req.body.role!==undefined){if(!['admin','manager','staff','reader'].includes(role))return res.status(400).json({error:'Ungültige Rolle.'});updates.push('role=?');values.push(role);}
  if(role==='admin'||req.body.permissions!==undefined||target.role==='admin'){
    if(req.body.permissions!==undefined&&role!=='admin'&&!Array.isArray(req.body.permissions))return res.status(400).json({error:'Ungültige Bereichsrechte.'});
    const perms=role==='admin'?allPermissions:Array.isArray(req.body.permissions)?req.body.permissions.filter(p=>allPermissions.includes(p)):[];
    updates.push('permissions=?');values.push(JSON.stringify(perms));
  }
  if(!updates.length)return res.status(400).json({error:'Keine Änderungen übergeben.'});
  values.push(id);db.prepare(`UPDATE users SET ${updates.join(',')} WHERE id=?`).run(...values);
  log(req.user,'update','users',id,'Benutzerstatus, Rolle oder Bereichsrechte geändert');
  res.json({ok:true});
});
app.put('/api/users/:id/password',auth,csrf,requireAdmin,(req,res)=>{
  const password=String(req.body.password||'');
  if(password.length<12) return res.status(400).json({error:'Passwort muss mindestens 12 Zeichen haben.'});
  const id=Number(req.params.id);
  const result=db.prepare("UPDATE users SET password_hash=? WHERE id=? AND role<>'owner'").run(bcrypt.hashSync(password,12),id);
  if(!result.changes) return res.status(404).json({error:'Benutzer nicht gefunden.'});
  log(req.user,'password_reset','users',id,'Passwort zurückgesetzt');
  res.json({ok:true});
});
app.get('/api/audit',auth,requireAdmin,(req,res)=>{
  res.json(db.prepare('SELECT id,username,action,section,record_id,details,created_at FROM audit_log ORDER BY id DESC LIMIT 300').all());
});

app.use(express.static(path.join(__dirname,'public'),{index:'index.html',maxAge:NODE_ENV==='production'?'1h':0}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Interner Serverfehler.'});});

app.listen(PORT,()=>console.log(`8 Block Grimz Portal läuft auf Port ${PORT}`));
