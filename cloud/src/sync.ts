/**
 * The sync endpoint's logic: verifying a desktop install's batch and
 * applying it to D1. Kept free of Worker globals (everything comes in as
 * arguments) so the desktop test suite can run it against node:sqlite.
 *
 * Format and row shapes: electron/sync/normalize.ts (shared, so the desktop
 * and the Worker can never disagree about table names, keys or SQL quoting).
 */
import {
  SYNC_FORMAT,
  SYNC_FORMAT_VERSION,
  TABLE_ORDER,
  TABLES,
  sqlLiteral,
  upsertStatements,
  type D1Row,
  type SyncBatch,
  type SyncResponse,
} from '../../electron/sync/normalize';

/** The subset of the D1 binding this file uses. */
export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown[]>;
}

export type PutBlob = (key: string, bytes: Uint8Array, contentType: string) => Promise<void>;

/**
 * Postgres schema versions this D1 schema (cloud/d1/migrations) mirrors. A
 * desktop app that has run a newer migration may have columns this mirror
 * lacks: it is refused until the D1 schema is updated to match.
 */
// 014 stays accepted after 015 is added: a computer that has not upgraded yet
// keeps syncing, it just has no fee decisions to send.
export const SUPPORTED_MIGRATIONS = new Set(['014_sync_outbox', '015_fee_decisions']);

/** How far a batch's timestamp may be from the Worker's clock. */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
/** Delete statements are chunked to stay well under D1's 100 KB statement limit. */
const DELETE_CHUNK = 500;

type Reply = { status: number; body: SyncResponse | { ok: true; secret: string } | { ok: false; error: string } };

const fail = (status: number, error: string, code?: Extract<SyncResponse, { ok: false }>['code']): Reply => ({
  status,
  body: { ok: false, error, ...(code ? { code } : {}) },
});

function now(): string {
  return new Date().toISOString();
}

function hex(bytes: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compares two strings in time independent of where they first differ. */
function sameString(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

// ── POST /sync/link ─────────────────────────────────────────────────────────

/**
 * Exchanges the link code (the LINK_CODE secret, known to whoever set the
 * Worker up) for a new install's signing secret. Only one install is active
 * at a time: linking revokes the previous one.
 */
export async function handleLink(db: Database, linkCode: string | undefined, bodyText: string): Promise<Reply> {
  if (!linkCode || linkCode.length < 12) return fail(500, 'The website has no link code set up (LINK_CODE).');
  let body: { linkCode?: unknown; installId?: unknown; label?: unknown };
  try {
    body = JSON.parse(bodyText);
  } catch {
    return fail(400, 'Bad request.', 'bad-request');
  }
  if (typeof body.linkCode !== 'string' || !sameString(body.linkCode, linkCode)) return fail(401, 'That link code is not right.', 'auth');
  if (typeof body.installId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.installId)) return fail(400, 'Bad install id.', 'bad-request');
  const label = typeof body.label === 'string' ? body.label.slice(0, 200) : 'Desktop app';

  const secret = hex(crypto.getRandomValues(new Uint8Array(32)));
  const at = now();
  await db.batch([
    db.prepare('UPDATE sync_installs SET revoked_at = ? WHERE revoked_at IS NULL').bind(at),
    db.prepare('INSERT INTO sync_installs (install_id, label, secret, created_at) VALUES (?, ?, ?, ?)').bind(body.installId, label, secret, at),
  ]);
  return { status: 200, body: { ok: true, secret } };
}

// ── POST /sync/batch ────────────────────────────────────────────────────────

type Install = { install_id: string; secret: string; revoked_at: string | null; full_sync_id: string | null; full_sync_started_at: string | null };

const columnCache = new Map<string, Set<string>>();

async function columnsOf(db: Database, table: string): Promise<Set<string>> {
  let columns = columnCache.get(table);
  if (!columns) {
    const result = await db.prepare(`PRAGMA table_info("${table}")`).all<{ name: string }>();
    columns = new Set(result.results.map((r) => r.name));
    columnCache.set(table, columns);
  }
  return columns;
}

/** For tests: forget cached table shapes. */
export function resetColumnCache() {
  columnCache.clear();
}

function deleteStatements(table: string, keys: D1Row[]): string[] {
  const pk = TABLES[table].pk;
  const out: string[] = [];
  for (let i = 0; i < keys.length; i += DELETE_CHUNK) {
    const chunk = keys.slice(i, i + DELETE_CHUNK);
    const tuples = chunk.map((key) => `(${pk.map((c) => sqlLiteral(key[c] ?? null)).join(', ')})`).join(', ');
    out.push(
      pk.length === 1
        ? `DELETE FROM ${table} WHERE ${pk[0]} IN (${chunk.map((key) => sqlLiteral(key[pk[0]] ?? null)).join(', ')});`
        : `DELETE FROM ${table} WHERE (${pk.join(', ')}) IN (VALUES ${tuples});`
    );
  }
  return out;
}

function isValue(value: unknown): value is string | number | null {
  return value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

export async function handleBatch(
  db: Database,
  headers: { install: string | null; timestamp: string | null; signature: string | null },
  bodyText: string,
  putBlob: PutBlob
): Promise<Reply> {
  // Who is asking, and is it really them?
  if (!headers.install || !headers.timestamp || !headers.signature) return fail(401, 'Missing signature.', 'auth');
  const install = await db
    .prepare('SELECT install_id, secret, revoked_at, full_sync_id, full_sync_started_at FROM sync_installs WHERE install_id = ?')
    .bind(headers.install)
    .first<Install>();
  if (!install) return fail(401, 'This computer is not linked to this website.', 'auth');
  if (install.revoked_at) return fail(403, 'Another computer has been linked to this website since. Link this one again to use it.', 'revoked');
  const sentAt = Number(headers.timestamp);
  if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > MAX_CLOCK_SKEW_MS) {
    return fail(401, "This computer's clock is more than 5 minutes out. Correct the date and time, then sync again.", 'auth');
  }
  if (!sameString(await hmac(install.secret, `${headers.timestamp}.${bodyText}`), headers.signature)) return fail(401, 'Bad signature.', 'auth');

  // Is it a batch we understand?
  let batch: SyncBatch;
  try {
    batch = JSON.parse(bodyText);
  } catch {
    return fail(400, 'Bad request.', 'bad-request');
  }
  if (batch.format !== SYNC_FORMAT || batch.version !== SYNC_FORMAT_VERSION || batch.installId !== install.install_id) {
    return fail(400, 'Not a sync batch this website understands.', 'bad-request');
  }
  if (typeof batch.batchId !== 'string' || !Array.isArray(batch.changes)) return fail(400, 'Bad request.', 'bad-request');
  if (!SUPPORTED_MIGRATIONS.has(batch.schemaMigration)) {
    return fail(409, `The website needs updating to accept data from this version of the app (database version ${batch.schemaMigration}).`, 'schema');
  }
  if (await db.prepare('SELECT 1 AS seen FROM sync_batches WHERE batch_id = ?').bind(batch.batchId).first()) {
    return { status: 200, body: { ok: true, applied: 0, duplicate: true } };
  }

  // Full-sync bookkeeping.
  const at = now();
  let stamp = at;
  const full = batch.mode === 'full' ? batch.full : undefined;
  if (batch.mode === 'full') {
    if (!full || typeof full.syncId !== 'string') return fail(400, 'Bad request.', 'bad-request');
    if (full.phase !== 'start' && full.syncId !== install.full_sync_id) {
      return fail(409, 'The website lost track of this full sync; starting again.', 'full-sync');
    }
    // Rows of this full sync must never look older than its start.
    if (full.phase !== 'start' && install.full_sync_started_at && stamp < install.full_sync_started_at) stamp = install.full_sync_started_at;
  } else if (batch.mode !== 'delta') {
    return fail(400, 'Bad request.', 'bad-request');
  }

  // Build every statement first, validating as we go; nothing is written
  // unless the whole batch is good.
  const sql: string[] = ['PRAGMA defer_foreign_keys = true;'];
  let applied = 0;

  // Deletes first, children before parents: a key that was deleted and a new
  // row now using its unique name can then arrive in the same batch.
  const deletes = batch.changes.filter((c) => c.op === 'delete');
  const upserts = batch.changes.filter((c) => c.op === 'upsert');
  if (deletes.length + upserts.length !== batch.changes.length) return fail(400, 'Unknown change type.', 'bad-request');
  const order = (table: string) => TABLE_ORDER.indexOf(table);

  for (const change of [...deletes].sort((a, b) => order(b.table) - order(a.table))) {
    if (change.op !== 'delete' || !TABLES[change.table] || !Array.isArray(change.keys)) return fail(400, `Bad delete for ${change.table}.`, 'bad-request');
    for (const key of change.keys) {
      if (!TABLES[change.table].pk.every((c) => isValue(key[c]))) return fail(400, `Bad key for ${change.table}.`, 'bad-request');
    }
    sql.push(...deleteStatements(change.table, change.keys));
    applied += change.keys.length;
  }

  for (const change of [...upserts].sort((a, b) => order(a.table) - order(b.table))) {
    if (change.op !== 'upsert' || !TABLES[change.table] || !Array.isArray(change.rows)) return fail(400, `Bad rows for ${change.table}.`, 'bad-request');
    if (change.rows.length === 0) continue;
    const known = await columnsOf(db, change.table);
    const columns = [...new Set(change.rows.flatMap((row) => Object.keys(row)))];
    const unknown = columns.filter((c) => !known.has(c) || c === '_synced_at');
    if (unknown.length > 0) {
      return fail(409, `The website needs updating: it has no ${change.table}.${unknown.join(', ')}.`, 'schema');
    }
    const rows = change.rows.map((row) => {
      const shaped: D1Row = {};
      for (const c of columns) {
        const value = row[c] ?? null;
        if (!isValue(value)) throw new Error(`Bad value in ${change.table}.${c}`);
        shaped[c] = value;
      }
      shaped._synced_at = stamp;
      return shaped;
    });
    sql.push(...upsertStatements(change.table, rows));
    applied += rows.length;
  }

  const statements = sql.map((s) => db.prepare(s));
  if (full?.phase === 'start') {
    statements.push(db.prepare('UPDATE sync_installs SET full_sync_id = ?, full_sync_started_at = ? WHERE install_id = ?').bind(full.syncId, at, install.install_id));
  }
  if (full?.phase === 'finish' && install.full_sync_started_at) {
    // Anything the full sync did not send no longer exists on the computer.
    for (const table of [...TABLE_ORDER].reverse()) {
      statements.push(db.prepare(`DELETE FROM ${table} WHERE _synced_at < ?`).bind(install.full_sync_started_at));
    }
    statements.push(
      db.prepare('UPDATE sync_installs SET full_sync_id = NULL, full_sync_started_at = NULL, last_full_sync_at = ? WHERE install_id = ?').bind(at, install.install_id)
    );
  }
  statements.push(
    db.prepare('INSERT INTO sync_batches (batch_id, install_id, mode, received_at, row_count) VALUES (?, ?, ?, ?, ?)').bind(batch.batchId, install.install_id, batch.mode, at, applied),
    db.prepare('UPDATE sync_installs SET last_batch_at = ?, app_version = ?, schema_migration = ? WHERE install_id = ?').bind(
      at,
      String(batch.appVersion ?? ''),
      batch.schemaMigration,
      install.install_id
    )
  );

  // Logos go to R2 first: a row pointing at a logo that is not there yet is
  // worse than a logo with no row (which the next upload overwrites).
  for (const blob of batch.blobs ?? []) {
    if (typeof blob.key !== 'string' || !/^logos\/[A-Za-z0-9]{1,8}\/[a-z0-9.]{1,20}$/.test(blob.key) || typeof blob.base64 !== 'string') {
      return fail(400, 'Bad logo.', 'bad-request');
    }
    const bytes = Uint8Array.from(atob(blob.base64), (c) => c.charCodeAt(0));
    await putBlob(blob.key, bytes, typeof blob.contentType === 'string' ? blob.contentType : 'application/octet-stream');
  }

  // One batch = one transaction: all of it applies, or none.
  await db.batch(statements);
  return { status: 200, body: { ok: true, applied } };
}
