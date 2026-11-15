/**
 * Ruzivo cloud Worker: one Worker, two jobs.
 *
 *   POST /sync/link    a desktop install exchanges the link code for its key
 *   POST /sync/batch   a desktop install sends signed changes (writes D1/R2)
 *   everything else    the read-only website, behind a sign-in: the
 *                      SITE_PASSWORD secret (password.ts) and/or
 *                      Cloudflare Access (access.ts)
 *
 * The /sync paths must be reachable without either (the desktop app signs
 * each request with its own key instead). See cloud/README.md.
 */
import { verifyAccess, type AccessEnv } from './access';
import { handleLogin, loginPage, logout, passwordEnabled, sessionViewer, type PasswordEnv } from './password';
import { renderSite, type SiteEnv } from './site';
import { handleBatch, handleLink, type Database } from './sync';

export interface Env extends AccessEnv, SiteEnv, PasswordEnv {
  DB: D1Database;
  LOGOS: R2Bucket;
  /** Set with `wrangler secret put LINK_CODE`: what an admin types to link a computer. */
  LINK_CODE?: string;
}

/** Large enough for a full-sync batch with logos (the desktop keeps batches near 1.5 MB). */
const MAX_BODY_BYTES = 10 * 1024 * 1024;

/** Neither Access nor a website password is configured: the site stays shut. */
const notSetUp = () =>
  new Response('This website is private, and no sign-in has been set up for it yet (SITE_PASSWORD or Cloudflare Access).', {
    status: 403,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const db = env.DB as unknown as Database;

    if (url.pathname.startsWith('/sync/')) {
      if (request.method !== 'POST') return json(405, { ok: false, error: 'POST only.' });
      if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BODY_BYTES) return json(413, { ok: false, error: 'Batch too large.' });
      const body = await request.text();
      if (body.length > MAX_BODY_BYTES) return json(413, { ok: false, error: 'Batch too large.' });
      try {
        if (url.pathname === '/sync/link') {
          const reply = await handleLink(db, env.LINK_CODE, body);
          return json(reply.status, reply.body);
        }
        if (url.pathname === '/sync/batch') {
          const reply = await handleBatch(
            db,
            {
              install: request.headers.get('X-Ruzivo-Install'),
              timestamp: request.headers.get('X-Ruzivo-Timestamp'),
              signature: request.headers.get('X-Ruzivo-Signature'),
            },
            body,
            async (key, bytes, contentType) => {
              await env.LOGOS.put(key, bytes, { httpMetadata: { contentType } });
            }
          );
          return json(reply.status, reply.body);
        }
        return json(404, { ok: false, error: 'Not found.' });
      } catch (error) {
        console.error('[sync]', error);
        return json(500, { ok: false, error: `The website could not save this batch: ${error instanceof Error ? error.message : String(error)}` });
      }
    }

    // ── The read-only website ──
    // Signed in through Cloudflare Access, or with the website password.
    if (url.pathname === '/login' && request.method === 'POST') return handleLogin(request, env, db);
    if (url.pathname === '/logout' && request.method === 'POST') return logout(request);
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });

    const viewer =
      (await verifyAccess(request, env).catch((error) => {
        console.error('[access]', error);
        return null;
      })) ?? (await sessionViewer(request, env));

    if (url.pathname === '/login') {
      return viewer ? Response.redirect(new URL('/', url).toString(), 303) : passwordEnabled(env) ? loginPage() : notSetUp();
    }
    if (!viewer) {
      return passwordEnabled(env) ? Response.redirect(new URL('/login', url).toString(), 303) : notSetUp();
    }

    const logo = /^\/logo\/([A-Za-z0-9]{1,8})$/.exec(url.pathname);
    if (logo) {
      const object = await env.LOGOS.get(`logos/${logo[1]}/r64.png`) ?? await env.LOGOS.get(`logos/${logo[1]}/original`);
      if (!object) return new Response('No logo', { status: 404 });
      return new Response(object.body, {
        headers: { 'Content-Type': object.httpMetadata?.contentType ?? 'image/png', 'Cache-Control': 'private, max-age=3600' },
      });
    }

    return renderSite(request, db, env, viewer);
  },
} satisfies ExportedHandler<Env>;
