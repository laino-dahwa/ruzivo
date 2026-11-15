/**
 * Password sign-in for the read-only website, for schools that don't use
 * Cloudflare Access. One shared password (the SITE_PASSWORD secret); a
 * correct one gets a signed, HttpOnly session cookie for SESSION_HOURS.
 *
 * The session is "<expiry>.<HMAC of expiry, keyed by the password>", so
 * changing SITE_PASSWORD signs everyone out, and nothing is stored per
 * session. Wrong guesses are counted per connection (CF-Connecting-IP) in
 * D1: MAX_FAILURES within FAILURE_WINDOW_MINUTES locks that connection out
 * until the window passes.
 */
import type { Viewer } from './access';
import type { Database } from './sync';
import { STYLE } from './site';

export type PasswordEnv = { SITE_PASSWORD?: string };

const COOKIE = 'ruzivo_session';
const SESSION_HOURS = 12;
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MINUTES = 15;
/** Shorter than this and the password is refused as not set up. */
export const MIN_PASSWORD_LENGTH = 10;

const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message)));
}

/** Equal-length digests compared without stopping at the first difference. */
async function samePassword(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', encoder.encode(given)), crypto.subtle.digest('SHA-256', encoder.encode(expected))]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export function passwordEnabled(env: PasswordEnv): boolean {
  return typeof env.SITE_PASSWORD === 'string' && env.SITE_PASSWORD.length >= MIN_PASSWORD_LENGTH;
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

export async function sessionViewer(request: Request, env: PasswordEnv): Promise<Viewer | null> {
  if (!passwordEnabled(env)) return null;
  const value = readCookie(request, COOKIE);
  const match = value ? /^(\d{10})\.([0-9a-f]{64})$/.exec(value) : null;
  if (!match) return null;
  const expires = Number(match[1]);
  if (expires < Math.floor(Date.now() / 1000)) return null;
  const expected = await hmac(env.SITE_PASSWORD!, `session.${expires}`);
  if (!(await samePassword(match[2], expected))) return null;
  return { email: 'Signed in with the website password', via: 'password' };
}

function cookieHeader(value: string, maxAge: number, request: Request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

const esc = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function loginPage(message?: string, status = 200): Response {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in</title><meta name="robots" content="noindex"><style>${STYLE}
.login{max-width:360px;margin:12vh auto 0;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:24px;display:grid;gap:14px}
.login input,.login button{width:100%}.err{color:var(--bad);margin:0}</style></head><body><main>
<form class="login" method="post" action="/login"><h1>Sign in</h1><p class="sub" style="margin:0">Enter the website password to view the school's records.</p>
<label for="password" class="sub" style="margin:0">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
${message ? `<p class="err">${esc(message)}</p>` : ''}<button type="submit">Sign in</button></form></main></body></html>`;
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' },
  });
}

export async function handleLogin(request: Request, env: PasswordEnv, db: Database): Promise<Response> {
  if (!passwordEnabled(env)) return loginPage('Password sign-in is not set up on this website.', 503);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const since = new Date(Date.now() - FAILURE_WINDOW_MINUTES * 60_000).toISOString();
  const recent = await db.prepare('SELECT count(*) AS n FROM login_failures WHERE ip = ? AND at > ?').bind(ip, since).first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_FAILURES) {
    return loginPage(`Too many wrong passwords. Try again in ${FAILURE_WINDOW_MINUTES} minutes.`, 429);
  }

  const form = await request.formData().catch(() => null);
  const password = form?.get('password');
  if (typeof password !== 'string' || !(await samePassword(password, env.SITE_PASSWORD!))) {
    await db.batch([
      db.prepare('DELETE FROM login_failures WHERE at < ?').bind(since),
      db.prepare('INSERT INTO login_failures (ip, at) VALUES (?, ?)').bind(ip, new Date().toISOString()),
    ]);
    return loginPage('That password is not right.', 401);
  }

  const expires = Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600;
  const value = `${expires}.${await hmac(env.SITE_PASSWORD!, `session.${expires}`)}`;
  return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': cookieHeader(value, SESSION_HOURS * 3600, request), 'Cache-Control': 'no-store' } });
}

export function logout(request: Request): Response {
  return new Response(null, { status: 303, headers: { Location: '/login', 'Set-Cookie': cookieHeader('', 0, request), 'Cache-Control': 'no-store' } });
}
