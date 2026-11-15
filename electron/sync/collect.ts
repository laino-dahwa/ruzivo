import type { ClientBase } from 'pg';
import { ident, qualified } from '../backup/catalog';
import { TABLE_ORDER, TABLES, normalizeRow, primaryKey, type Blob, type D1Row, type SyncChange } from './normalize';

/** One sync_outbox row: the key of a row that changed. */
export type OutboxEntry = { id: string; table: string; pk: Record<string, unknown> };

export type Collected = { changes: SyncChange[]; blobs: Blob[]; rowCount: number };

const SCHEMA = 'public';

export async function readOutbox(client: ClientBase, limit: number): Promise<OutboxEntry[]> {
  const result = await client.query('SELECT id::text AS id, table_name, pk FROM sync_outbox ORDER BY id LIMIT $1', [limit]);
  return result.rows.map((row) => ({ id: String(row.id), table: String(row.table_name), pk: row.pk as Record<string, unknown> }));
}

export async function pendingCount(client: ClientBase): Promise<number> {
  const result = await client.query('SELECT count(*)::int AS n FROM sync_outbox');
  return result.rows[0].n as number;
}

/**
 * Rows of `table` as row_to_json renders them (the backup's own format), for
 * the given primary keys, or every row when `keys` is 'all'. Keys are matched
 * through jsonb_populate_recordset so each key value takes its column's real
 * type and the primary key index is used.
 */
async function fetchRows(client: ClientBase, table: string, keys: Record<string, unknown>[] | 'all'): Promise<Record<string, unknown>[]> {
  const source = qualified(SCHEMA, table);
  const pk = TABLES[table].pk;
  if (keys === 'all') {
    const result = await client.query(`SELECT row_to_json(t)::text AS j FROM ${source} t ORDER BY ${pk.map((c) => `t.${ident(c)}`).join(', ')}`);
    return result.rows.map((row) => JSON.parse(row.j));
  }
  if (keys.length === 0) return [];
  const on = pk.map((c) => `t.${ident(c)} = k.${ident(c)}`).join(' AND ');
  const result = await client.query(
    `SELECT row_to_json(t)::text AS j FROM ${source} t JOIN jsonb_populate_recordset(NULL::${source}, $1::jsonb) k ON ${on}`,
    [JSON.stringify(keys)]
  );
  return result.rows.map((row) => JSON.parse(row.j));
}

/**
 * Fills the school_id the mirror adds to payments (the school of the learner
 * the payment is allocated to) and expenses (the school of the category).
 */
async function deriveSchoolIds(client: ClientBase, table: string, rows: D1Row[]): Promise<void> {
  if (rows.length === 0 || !TABLES[table].derivedSchoolId) return;
  const idColumn = table === 'payments' ? 'payment_id' : 'expense_id';
  const ids = rows.map((r) => String(r[idColumn]));
  const result =
    table === 'payments'
      ? await client.query(
          `SELECT DISTINCT ON (pa.payment_id) pa.payment_id::text AS id, rtrim(l.school_id) AS school_id
           FROM payment_allocations pa
           JOIN charges c ON c.charge_id = pa.charge_id
           JOIN learners l ON l.learner_id = c.learner_id
           WHERE pa.payment_id = ANY($1::bigint[])
           ORDER BY pa.payment_id, pa.allocation_id`,
          [ids]
        )
      : await client.query(
          `SELECT x.expense_id::text AS id, rtrim(ec.school_id) AS school_id
           FROM expenses x JOIN expense_categories ec ON ec.expense_category_id = x.expense_category_id
           WHERE x.expense_id = ANY($1::bigint[])`,
          [ids]
        );
  const schoolOf = new Map(result.rows.map((row) => [String(row.id), String(row.school_id)]));
  for (const row of rows) row.school_id = schoolOf.get(String(row[idColumn])) ?? null;
}

function normalizeAll(table: string, rows: Record<string, unknown>[]): { rows: D1Row[]; blobs: Blob[] } {
  const out: D1Row[] = [];
  const blobs: Blob[] = [];
  for (const row of rows) {
    const normalized = normalizeRow(table, row);
    out.push(normalized.row);
    blobs.push(...normalized.blobs);
  }
  return { rows: out, blobs };
}

const keyString = (key: D1Row) => JSON.stringify(Object.keys(key).sort().map((k) => [k, key[k]]));

/**
 * Turns outbox entries into changes: each changed key's CURRENT row is sent
 * as an upsert, and a key whose row no longer exists is sent as a delete.
 * Many entries for the same row collapse into one.
 */
export async function collectChanges(client: ClientBase, entries: OutboxEntry[]): Promise<Collected> {
  const keysByTable = new Map<string, Map<string, Record<string, unknown>>>();
  const want = (table: string, pk: Record<string, unknown>) => {
    if (!TABLES[table]) return; // a table this version does not mirror
    if (!keysByTable.has(table)) keysByTable.set(table, new Map());
    keysByTable.get(table)!.set(JSON.stringify(pk), pk);
  };
  for (const entry of entries) want(entry.table, entry.pk);

  // A payment's school comes from its allocation, which can be written after
  // the payment itself: resend the payment whenever an allocation changes.
  const allocationIds = [...(keysByTable.get('payment_allocations')?.values() ?? [])].map((k) => String(k.allocation_id));
  if (allocationIds.length > 0) {
    const result = await client.query(
      'SELECT DISTINCT payment_id FROM payment_allocations WHERE allocation_id = ANY($1::bigint[])',
      [allocationIds]
    );
    for (const row of result.rows) want('payments', { payment_id: Number(row.payment_id) });
  }

  const upserts: SyncChange[] = [];
  const deletes: SyncChange[] = [];
  const blobs: Blob[] = [];
  let rowCount = 0;

  for (const table of TABLE_ORDER) {
    const keys = keysByTable.get(table);
    if (!keys) continue;
    const found = normalizeAll(table, await fetchRows(client, table, [...keys.values()]));
    await deriveSchoolIds(client, table, found.rows);
    blobs.push(...found.blobs);

    const present = new Set(found.rows.map((row) => keyString(primaryKey(table, row))));
    const gone = [...keys.values()]
      .map((pk) => primaryKey(table, normalizeRow(table, pk).row))
      .filter((key) => !present.has(keyString(key)));

    if (found.rows.length > 0) upserts.push({ table, op: 'upsert', rows: found.rows });
    if (gone.length > 0) deletes.unshift({ table, op: 'delete', keys: gone }); // children first
    rowCount += found.rows.length + gone.length;
  }

  return { changes: [...upserts, ...deletes], blobs, rowCount };
}

/** Every row of every mirrored table, for a full sync. Run inside one snapshot. */
export async function collectEverything(client: ClientBase): Promise<{ table: string; rows: D1Row[]; blobs: Blob[] }[]> {
  const tables: { table: string; rows: D1Row[]; blobs: Blob[] }[] = [];
  for (const table of TABLE_ORDER) {
    const exists = await client.query('SELECT to_regclass($1) IS NOT NULL AS ok', [qualified(SCHEMA, table)]);
    if (!exists.rows[0]?.ok) continue;
    const normalized = normalizeAll(table, await fetchRows(client, table, 'all'));
    await deriveSchoolIds(client, table, normalized.rows);
    tables.push({ table, ...normalized });
  }
  return tables;
}
