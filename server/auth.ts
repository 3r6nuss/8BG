import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { parse, serialize } from 'cookie';
import type { Request, Response, NextFunction } from 'express';
import type { Database } from './database.js';

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = '8bg_session';
const SESSION_SECONDS = 60 * 60 * 12;
export const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');

export interface User { id: string; username: string; role: 'admin' | 'member' }

declare global {
  namespace Express {
    interface Request { user?: User; csrfToken?: string; sessionHash?: string }
  }
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}

export async function verifyPassword(password: string, hash: string) {
  const [salt, encoded] = hash.split(':');
  if (!salt || !encoded) return false;
  const key = await scrypt(password, salt, 64) as Buffer;
  const expected = Buffer.from(encoded, 'hex');
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function issueSession(db: Database, res: Response, userId: string, secure: boolean) {
  const token = randomBytes(32).toString('hex');
  const csrfToken = randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token_hash,user_id,csrf_token,expires_at) VALUES (?,?,?,?)')
    .run(hashToken(token), userId, csrfToken, Date.now() + SESSION_SECONDS * 1000);
  res.setHeader('Set-Cookie', serialize(COOKIE_NAME, token, {
    httpOnly: true, sameSite: 'strict', secure, path: '/', maxAge: SESSION_SECONDS,
  }));
  return csrfToken;
}

export function clearSession(res: Response, secure: boolean) {
  res.setHeader('Set-Cookie', serialize(COOKIE_NAME, '', {
    httpOnly: true, sameSite: 'strict', secure, path: '/', maxAge: 0,
  }));
}

export function authenticate(db: Database) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = parse(req.headers.cookie || '')[COOKIE_NAME];
    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      res.status(401).json({ error: 'Bitte melde dich an.' });
      return;
    }
    const sessionHash = hashToken(token);
    const row = db.prepare(`SELECT u.id,u.username,u.role,s.csrf_token FROM sessions s
      JOIN users u ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?`)
      .get(sessionHash, Date.now()) as (User & { csrf_token: string }) | undefined;
    if (!row) {
      res.status(401).json({ error: 'Deine Sitzung ist abgelaufen. Bitte erneut anmelden.' });
      return;
    }
    req.user = { id: row.id, username: row.username, role: row.role };
    req.csrfToken = row.csrf_token;
    req.sessionHash = sessionHash;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-csrf-token'] !== row.csrf_token) {
      res.status(403).json({ error: 'Ungültige Sicherheitsprüfung. Bitte lade die Seite neu.' });
      return;
    }
    next();
  };
}

export function adminOnly(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Diese Funktion ist nur für Administratoren verfügbar.' });
    return;
  }
  next();
}
