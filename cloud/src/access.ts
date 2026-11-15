/**
 * Cloudflare Access check for the read-only website.
 *
 * The site holds learners' details and staff salaries, so it only serves a
 * request that carries a valid Access token (Cf-Access-Jwt-Assertion) for
 * this application. A header alone proves nothing (anyone can send one), so
 * the token's RS256 signature is verified against the team's published keys,
 * along with its audience and expiry. With ACCESS_TEAM_DOMAIN/ACCESS_AUD
 * unset, every page is refused: the site fails closed, never open.
 */

export type AccessEnv = {
  /** e.g. "yourschool.cloudflareaccess.com" */
  ACCESS_TEAM_DOMAIN?: string;
  /** The Access application's "Application Audience (AUD) Tag". */
  ACCESS_AUD?: string;
  /** "true" only in .dev.vars, for `wrangler dev` on your own computer. */
  DEV_ALLOW_UNAUTHENTICATED?: string;
};

/** Who is looking, and how they got in ('password' viewers get a Sign out button). */
export type Viewer = { email: string; via?: 'access' | 'password' | 'local' };

type Jwk = JsonWebKey & { kid?: string };
let cachedKeys: { domain: string; keys: Jwk[]; fetchedAt: number } | null = null;
const KEY_CACHE_MS = 60 * 60 * 1000;

function base64UrlDecode(input: string): Uint8Array<ArrayBuffer> {
  const binary = atob(input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '='));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function teamKeys(domain: string, refresh = false): Promise<Jwk[]> {
  if (!refresh && cachedKeys && cachedKeys.domain === domain && Date.now() - cachedKeys.fetchedAt < KEY_CACHE_MS) return cachedKeys.keys;
  const response = await fetch(`https://${domain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`Could not load Access keys (${response.status})`);
  const body = (await response.json()) as { keys?: Jwk[] };
  cachedKeys = { domain, keys: body.keys ?? [], fetchedAt: Date.now() };
  return cachedKeys.keys;
}

export async function verifyAccess(request: Request, env: AccessEnv): Promise<Viewer | null> {
  const local = new URL(request.url).hostname;
  if (env.DEV_ALLOW_UNAUTHENTICATED === 'true' && (local === 'localhost' || local === '127.0.0.1')) {
    return { email: 'local developer', via: 'local' };
  }
  const domain = env.ACCESS_TEAM_DOMAIN?.replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!domain || !env.ACCESS_AUD) return null;

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  let header: { alg?: string; kid?: string };
  let payload: { aud?: string | string[]; exp?: number; nbf?: number; iss?: string; email?: string };
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
  } catch {
    return null;
  }
  if (header.alg !== 'RS256') return null;

  let keys = await teamKeys(domain);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await teamKeys(domain, true); // keys rotate
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) return null;

  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlDecode(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  if (!valid) return null;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(env.ACCESS_AUD)) return null;
  if (typeof payload.exp !== 'number' || payload.exp < nowSeconds) return null;
  if (typeof payload.nbf === 'number' && payload.nbf > nowSeconds + 60) return null;
  if (payload.iss && payload.iss !== `https://${domain}`) return null;

  return { email: payload.email ?? 'signed in', via: 'access' };
}
