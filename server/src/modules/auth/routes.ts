import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Q } from '../../db.js';
import { AppError, conflict, notFound } from '../../lib/errors.js';
import { idParam } from '../../lib/validation.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export type Role = 'admin' | 'office' | 'mechanic';
export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  mechanic_id: number | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export const SESSION_COOKIE = 'af_session';
const SESSION_DAYS = 14;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [algo, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(pw, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

const tokenHash = (t: string) => createHash('sha256').update(t).digest('hex');

async function createSession(q: Q, userId: number) {
  const token = randomBytes(32).toString('base64url');
  await q.query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))`, [
    tokenHash(token),
    userId,
    SESSION_DAYS,
  ]);
  await q.query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
  return token;
}

function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: SESSION_DAYS * 86400,
  });
}

/**
 * Behörighet per roll. Mekaniker kommer inte åt ekonomi och administration.
 * Kontor kommer åt allt utom användarhantering och verkstadsinställningar.
 */
const RULES: { test: (method: string, path: string) => boolean; roles: Role[] }[] = [
  { test: (_m, p) => p.startsWith('/api/users'), roles: ['admin'] },
  { test: (m, p) => p.startsWith('/api/settings') && m !== 'GET', roles: ['admin'] },
  { test: (m, p) => p.startsWith('/api/mechanics') && m !== 'GET', roles: ['admin'] },
  {
    test: (_m, p) =>
      p.startsWith('/api/invoices') || p.startsWith('/api/reports') || p.startsWith('/api/accounting'),
    roles: ['admin', 'office'],
  },
  { test: (m, p) => p.startsWith('/api/quotes') && m !== 'GET', roles: ['admin', 'office'] },
  { test: (m, p) => p.startsWith('/api/articles') && m !== 'GET' && !p.endsWith('/stock'), roles: ['admin', 'office'] },
];

export function canAccess(role: Role, method: string, path: string) {
  const rule = RULES.find((r) => r.test(method, path));
  return !rule || rule.roles.includes(role);
}

const PUBLIC = ['/api/auth/status', '/api/auth/login', '/api/auth/setup'];

// Enkel spärr mot lösenordsgissning: 10 misslyckade försök per e-post och IP på 15 minuter
const failures = new Map<string, { n: number; until: number }>();
function tooManyAttempts(key: string) {
  const f = failures.get(key);
  return !!f && f.n >= 10 && f.until > Date.now();
}
function recordFailure(key: string) {
  const f = failures.get(key);
  const until = Date.now() + 15 * 60_000;
  failures.set(key, { n: f && f.until > Date.now() ? f.n + 1 : 1, until });
}

const passwordSchema = z.string().min(8, 'Lösenordet ska vara minst 8 tecken').max(200);
const userCreate = z
  .object({
    email: z.string().trim().toLowerCase().email('Ogiltig e-postadress'),
    name: z.string().trim().min(1, 'Namn krävs').max(100),
    password: passwordSchema,
    role: z.enum(['admin', 'office', 'mechanic']),
    mechanic_id: z.number().int().positive().nullish(),
  })
  .strict();
const userUpdate = z
  .object({
    name: z.string().trim().min(1).max(100),
    role: z.enum(['admin', 'office', 'mechanic']),
    mechanic_id: z.number().int().positive().nullish(),
    active: z.boolean(),
    password: passwordSchema,
  })
  .partial()
  .strict();

const USER_COLS = 'id, email, name, role, mechanic_id, active, last_login_at, created_at';

export async function authRoutes(app: FastifyInstance) {
  const { db } = app;

  app.addHook('onRequest', async (req: FastifyRequest) => {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/') || PUBLIC.includes(path)) return;
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      const user = (
        await db.query<AuthUser>(
          `SELECT u.id, u.email, u.name, u.role, u.mechanic_id FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`,
          [tokenHash(token)],
        )
      ).rows[0];
      if (user) req.user = user;
    }
    if (!req.user) throw new AppError(401, 'unauthorized', 'Du behöver logga in');
    if (!canAccess(req.user.role, req.method, path)) {
      throw new AppError(403, 'forbidden', 'Din roll har inte behörighet till detta');
    }
  });

  app.get('/api/auth/status', async (req) => {
    const count = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM users')).rows[0].n;
    const token = req.cookies[SESSION_COOKIE];
    let user: AuthUser | null = null;
    if (token) {
      user =
        (
          await db.query<AuthUser>(
            `SELECT u.id, u.email, u.name, u.role, u.mechanic_id FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`,
            [tokenHash(token)],
          )
        ).rows[0] ?? null;
    }
    return { setup_required: count === 0, user };
  });

  // Första start: skapa administratören
  app.post('/api/auth/setup', async (req, reply) => {
    const data = userCreate.omit({ role: true, mechanic_id: true }).parse(req.body);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('LOCK TABLE users IN EXCLUSIVE MODE');
      const n = (await client.query<{ n: number }>('SELECT count(*)::int AS n FROM users')).rows[0].n;
      if (n > 0) throw conflict('Det finns redan användare. Logga in i stället.');
      const user = (
        await client.query<AuthUser>(
          `INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, 'admin') RETURNING ${USER_COLS}`,
          [data.email, data.name, await hashPassword(data.password)],
        )
      ).rows[0];
      const token = await createSession(client, user.id);
      await client.query('COMMIT');
      setSessionCookie(reply, token);
      return reply.code(201).send({ user });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  app.post('/api/auth/login', async (req, reply) => {
    const { email, password } = z
      .object({ email: z.string().trim().toLowerCase(), password: z.string() })
      .parse(req.body);
    const key = `${email}|${req.ip}`;
    if (tooManyAttempts(key)) throw new AppError(429, 'too_many_attempts', 'För många försök. Vänta en stund och försök igen.');
    const row = (
      await db.query<AuthUser & { password_hash: string; active: boolean }>(
        `SELECT id, email, name, role, mechanic_id, password_hash, active FROM users WHERE lower(email) = $1`,
        [email],
      )
    ).rows[0];
    if (!row || !row.active || !(await verifyPassword(password, row.password_hash))) {
      recordFailure(key);
      throw new AppError(401, 'invalid_login', 'Fel e-post eller lösenord');
    }
    failures.delete(key);
    const token = await createSession(db, row.id);
    setSessionCookie(reply, token);
    const { password_hash: _ph, active: _a, ...user } = row;
    return { user };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(token)]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/auth/password', async (req) => {
    const body = z.object({ current_password: z.string(), new_password: passwordSchema }).strict().parse(req.body);
    const row = (await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [req.user!.id])).rows[0];
    if (!(await verifyPassword(body.current_password, row.password_hash))) {
      throw new AppError(400, 'validation_error', 'Nuvarande lösenord stämmer inte', [
        { field: 'current_password', message: 'Fel lösenord' },
      ]);
    }
    await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user!.id, await hashPassword(body.new_password)]);
    // Logga ut övriga enheter
    const current = tokenHash(req.cookies[SESSION_COOKIE]!);
    await db.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [req.user!.id, current]);
    return { ok: true };
  });

  // Användarhantering (bara admin, se RULES)
  app.get('/api/users', async () => ({ items: (await db.query(`SELECT ${USER_COLS} FROM users ORDER BY name`)).rows }));

  app.post('/api/users', async (req, reply) => {
    const d = userCreate.parse(req.body);
    const res = await db.query(
      `INSERT INTO users (email, name, password_hash, role, mechanic_id) VALUES ($1, $2, $3, $4, $5) RETURNING ${USER_COLS}`,
      [d.email, d.name, await hashPassword(d.password), d.role, d.mechanic_id ?? null],
    );
    return reply.code(201).send(res.rows[0]);
  });

  app.patch('/api/users/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const d = userUpdate.parse(req.body);
    if (id === req.user!.id && (d.active === false || (d.role && d.role !== 'admin'))) {
      throw conflict('Du kan inte ta bort din egen administratörsbehörighet');
    }
    const sets: string[] = [];
    const vals: unknown[] = [id];
    const add = (col: string, v: unknown) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if (d.name !== undefined) add('name', d.name);
    if (d.role !== undefined) add('role', d.role);
    if (d.mechanic_id !== undefined) add('mechanic_id', d.mechanic_id);
    if (d.active !== undefined) add('active', d.active);
    if (d.password !== undefined) add('password_hash', await hashPassword(d.password));
    if (sets.length) await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, vals);
    if (d.active === false || d.password !== undefined) await db.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    const user = (await db.query(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [id])).rows[0];
    if (!user) throw notFound('Användaren');
    return user;
  });
}
