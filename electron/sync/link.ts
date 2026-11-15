import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import type { SyncLink } from './engine';

/**
 * This computer's link to the school's sync Worker. The URL and install id
 * live in a plain JSON file in userData; the signing secret is encrypted at
 * rest with Electron's safeStorage, like the database password
 * (config-store.ts). Never in the database: a backup restored on another
 * computer must not carry this computer's link with it.
 */
type StoredLink = { workerUrl: string; installId: string; encryptedSecret: string; linkedAt: string; linkedBy: string };

export type LinkInfo = { workerUrl: string; installId: string; linkedAt: string; linkedBy: string };

function linkPath() {
  return path.join(app.getPath('userData'), 'sync-link.json');
}

function readStored(): StoredLink | null {
  const file = linkPath();
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as StoredLink;
  } catch {
    return null;
  }
}

export function getLinkInfo(): LinkInfo | null {
  const stored = readStored();
  return stored ? { workerUrl: stored.workerUrl, installId: stored.installId, linkedAt: stored.linkedAt, linkedBy: stored.linkedBy } : null;
}

export function getLink(): SyncLink | null {
  const stored = readStored();
  if (!stored || !safeStorage.isEncryptionAvailable()) return null;
  try {
    const secret = safeStorage.decryptString(Buffer.from(stored.encryptedSecret, 'base64'));
    return { workerUrl: stored.workerUrl, installId: stored.installId, secret };
  } catch {
    return null;
  }
}

export function removeLink(): void {
  rmSync(linkPath(), { force: true });
}

/** Only https, except a local `wrangler dev` Worker. */
export function normalizeWorkerUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Enter the website address, e.g. https://ruzivo-sync.yourschool.workers.dev');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('The website address must start with https://');
  }
  return url.origin;
}

/**
 * Exchanges the one-time link code (the Worker's LINK_CODE secret) for this
 * computer's own signing secret. Linking replaces whichever computer was
 * linked before: only one may write to the website.
 */
export async function createLink(input: { workerUrl: string; linkCode: string; label: string; linkedBy: string }): Promise<LinkInfo> {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('This computer cannot store the link securely.');
  const workerUrl = normalizeWorkerUrl(input.workerUrl);
  const installId = randomUUID();

  let response: Response;
  try {
    response = await fetch(new URL('/sync/link', workerUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linkCode: input.linkCode.trim(), installId, label: input.label }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error('Could not reach the website. Check the address and the internet connection.');
  }
  const body = (await response.json().catch(() => null)) as { ok?: boolean; secret?: string; error?: string } | null;
  if (!response.ok || !body?.ok || typeof body.secret !== 'string') {
    throw new Error(body?.error ?? `The website refused the link (${response.status}).`);
  }

  const stored: StoredLink = {
    workerUrl,
    installId,
    encryptedSecret: safeStorage.encryptString(body.secret).toString('base64'),
    linkedAt: new Date().toISOString(),
    linkedBy: input.linkedBy,
  };
  writeFileSync(linkPath(), JSON.stringify(stored, null, 2), 'utf8');
  return { workerUrl, installId, linkedAt: stored.linkedAt, linkedBy: stored.linkedBy };
}
