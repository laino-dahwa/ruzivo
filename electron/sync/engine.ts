import { createHmac, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { appliedMigrations } from '../backup/catalog';
import { collectChanges, collectEverything, pendingCount, readOutbox } from './collect';
import {
  SYNC_FORMAT,
  SYNC_FORMAT_VERSION,
  type Blob,
  type D1Row,
  type SyncBatch,
  type SyncChange,
  type SyncResponse,
} from './normalize';

/** This computer's link to the school's sync Worker (see link.ts). */
export type SyncLink = { workerUrl: string; installId: string; secret: string };

export type SyncRunResult = { mode: 'delta' | 'full' | 'idle'; rows: number; batches: number; pending: number };

/** Outbox entries per delta batch; a run sends at most MAX_DELTA_BATCHES. */
const DELTA_BATCH_SIZE = 400;
const MAX_DELTA_BATCHES = 25;
/** A full-sync batch closes at whichever limit it reaches first. */
const FULL_BATCH_ROWS = 400;
const FULL_BATCH_BYTES = 1_500_000;

export class SyncError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

/** The headers the Worker checks: HMAC-SHA256 over "<timestamp>.<body>". */
export function signBody(secret: string, body: string, timestamp = Date.now().toString()) {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return { 'X-Ruzivo-Timestamp': timestamp, 'X-Ruzivo-Signature': signature };
}

async function post(link: SyncLink, batch: SyncBatch): Promise<SyncResponse & { ok: true }> {
  const body = JSON.stringify(batch);
  let response: Response;
  try {
    response = await fetch(new URL('/sync/batch', link.workerUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ruzivo-Install': link.installId, ...signBody(link.secret, body) },
      body,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw new SyncError(`Could not reach the website (${error instanceof Error ? error.message : String(error)}).`, 'offline');
  }
  const result = (await response.json().catch(() => null)) as SyncResponse | null;
  if (!response.ok || !result || !result.ok) {
    const error = result && !result.ok ? result : { error: `The website answered ${response.status}.`, code: undefined };
    throw new SyncError(error.error, error.code);
  }
  return result;
}

function toWire(blobs: Blob[]) {
  return blobs.map((b) => ({ key: b.key, contentType: b.contentType, base64: b.bytes.toString('base64') }));
}

export async function getState(client: PoolClient | Pool): Promise<Record<string, string | null>> {
  const result = await client.query('SELECT key, value FROM sync_state');
  return Object.fromEntries(result.rows.map((row) => [String(row.key), row.value as string | null]));
}

export async function setState(client: PoolClient | Pool, values: Record<string, string | null>): Promise<void> {
  for (const [key, value] of Object.entries(values)) {
    await client.query(
      `INSERT INTO sync_state (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, value]
    );
  }
}

/** Asks for the next run to resend everything (after linking, restore, or a Worker request). */
export async function requestFullSync(pool: Pool): Promise<void> {
  await setState(pool, { needs_full_sync: 'true' });
}

/**
 * While no website is linked the outbox has nobody to drain it; it is
 * emptied instead, since linking always starts with a full sync.
 */
export async function discardOutbox(pool: Pool): Promise<void> {
  await pool.query('TRUNCATE sync_outbox');
  await setState(pool, { needs_full_sync: 'true' });
}

/**
 * One sync run: a full sync when one is due, otherwise up to
 * MAX_DELTA_BATCHES batches of outbox changes. Throws SyncError on failure,
 * leaving the outbox as it was so the next run retries.
 */
export async function runSync(pool: Pool, link: SyncLink, appVersion: string): Promise<SyncRunResult> {
  const client = await pool.connect();
  try {
    const migrations = await appliedMigrations(client, 'public');
    const header = {
      format: SYNC_FORMAT,
      version: SYNC_FORMAT_VERSION,
      installId: link.installId,
      appVersion,
      schemaMigration: migrations[migrations.length - 1] ?? '',
    } as const;

    let result: SyncRunResult;
    try {
      const state = await getState(client);
      result = state.needs_full_sync === 'true' ? await fullSync(client, link, header) : await deltaSync(client, link, header);
    } catch (error) {
      if (error instanceof SyncError && error.code === 'full-sync') await setState(client, { needs_full_sync: 'true' });
      throw error;
    }
    await setState(client, { last_success_at: new Date().toISOString(), last_error: null });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setState(client, { last_error: message, last_error_at: new Date().toISOString() }).catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

type Header = Pick<SyncBatch, 'format' | 'version' | 'installId' | 'appVersion' | 'schemaMigration'>;

async function deltaSync(client: PoolClient, link: SyncLink, header: Header): Promise<SyncRunResult> {
  let rows = 0;
  let batches = 0;
  for (; batches < MAX_DELTA_BATCHES; ) {
    const entries = await readOutbox(client, DELTA_BATCH_SIZE);
    if (entries.length === 0) break;

    // Read in one snapshot so the rows agree with each other.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    let collected;
    try {
      collected = await collectChanges(client, entries);
    } finally {
      await client.query('COMMIT');
    }

    if (collected.changes.length > 0 || collected.blobs.length > 0) {
      await post(link, {
        ...header,
        batchId: randomUUID(),
        createdAt: new Date().toISOString(),
        mode: 'delta',
        changes: collected.changes,
        blobs: toWire(collected.blobs),
      });
      batches++;
    }
    // Exactly the entries read, never "up to id N": an entry with a lower id
    // whose transaction committed after the read is still waiting.
    await client.query('DELETE FROM sync_outbox WHERE id = ANY($1::bigint[])', [entries.map((e) => e.id)]);
    rows += collected.rowCount;
    if (entries.length < DELTA_BATCH_SIZE) break;
  }
  return { mode: batches > 0 ? 'delta' : 'idle', rows, batches, pending: await pendingCount(client) };
}

async function fullSync(client: PoolClient, link: SyncLink, header: Header): Promise<SyncRunResult> {
  // Everything is read in ONE snapshot, together with the outbox entries and
  // the full-sync request it already covers.
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  let tables;
  let coveredIds: string[];
  let requestedAt: string | null;
  try {
    coveredIds = (await client.query('SELECT id::text AS id FROM sync_outbox')).rows.map((r) => String(r.id));
    requestedAt = (await client.query("SELECT updated_at::text AS at FROM sync_state WHERE key = 'needs_full_sync'")).rows[0]?.at ?? null;
    tables = await collectEverything(client);
  } finally {
    await client.query('COMMIT');
  }

  const syncId = randomUUID();
  const send = (phase: 'start' | 'rows' | 'finish', changes: SyncChange[], blobs: Blob[] = []) =>
    post(link, {
      ...header,
      batchId: randomUUID(),
      createdAt: new Date().toISOString(),
      mode: 'full',
      full: { syncId, phase },
      changes,
      blobs: toWire(blobs),
    });

  await send('start', []);
  let batches = 1;
  let rows = 0;

  let changes: SyncChange[] = [];
  let blobs: Blob[] = [];
  let batchRows = 0;
  let batchBytes = 0;
  const flush = async () => {
    if (batchRows === 0) return;
    await send('rows', changes, blobs);
    batches++;
    changes = [];
    blobs = [];
    batchRows = 0;
    batchBytes = 0;
  };

  for (const { table, rows: tableRows, blobs: tableBlobs } of tables) {
    const blobsByKey = new Map(tableBlobs.map((b) => [b.key, b]));
    let current: D1Row[] = [];
    for (const row of tableRows) {
      const rowBlobs = Object.entries(row)
        .filter(([column, value]) => column.endsWith('_r2_key') && typeof value === 'string' && blobsByKey.has(value))
        .map(([, value]) => blobsByKey.get(value as string)!);
      const size = JSON.stringify(row).length + rowBlobs.reduce((sum, b) => sum + Math.ceil(b.bytes.length * 1.37), 0);

      if (batchRows > 0 && (batchRows >= FULL_BATCH_ROWS || batchBytes + size > FULL_BATCH_BYTES)) {
        if (current.length > 0) changes.push({ table, op: 'upsert', rows: current });
        current = [];
        await flush();
      }
      current.push(row);
      blobs.push(...rowBlobs);
      batchRows++;
      batchBytes += size;
      rows++;
    }
    if (current.length > 0) changes.push({ table, op: 'upsert', rows: current });
  }
  await flush();
  await send('finish', []);
  batches++;

  // The snapshot covered these changes; anything newer stays queued.
  await client.query('DELETE FROM sync_outbox WHERE id = ANY($1::bigint[])', [coveredIds]);
  // Only clear the request this full sync answered (a restore since then asks again).
  await client.query(
    `UPDATE sync_state SET value = 'false', updated_at = CURRENT_TIMESTAMP
     WHERE key = 'needs_full_sync' AND ($1::timestamptz IS NULL OR updated_at <= $1::timestamptz)`,
    [requestedAt]
  );
  await setState(client, { last_full_sync_at: new Date().toISOString() });
  return { mode: 'full', rows, batches, pending: await pendingCount(client) };
}
