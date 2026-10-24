import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';
import { appliedMigrations, ident, insertOrder, listColumns, listTables, qualified, standaloneSequences } from './catalog';
import type { BackupManifest } from './format';

/**
 * Runs this app's migrations against `schema`: all of them, or only the
 * first `count`. Injected so the Electron main process and the tests can each
 * supply node-pg-migrate with their own connection settings.
 */
export type MigrateFn = (options: { schema: string; count?: number }) => Promise<void>;

/** Where a backup is assembled before it replaces anything. */
export const STAGING_SCHEMA = 'ruzivo_restore';

// Held for the whole restore so two restores can never overlap.
const RESTORE_LOCK_KEY = 0x52555a49; // "RUZI"

export type RestoreResult = { tables: number; rows: number };

/**
 * Replaces all application data in `public` with a verified backup
 * (read-backup.ts must already have accepted `dir`).
 *
 * 1. Build a scratch schema at the backup's own schema version (its first N
 *    migrations), load the rows into it, then run the remaining migrations.
 *    Any data changes later migrations make (back-fills, renamed values)
 *    happen to the restored data exactly as they did to live data - rows
 *    are never squeezed straight into a newer table shape.
 * 2. In ONE transaction: empty every live table, copy the scratch tables in,
 *    reset id counters and sequences, and check the row counts. If anything
 *    fails, the transaction rolls back and the live data is untouched.
 *
 * Original ids are kept (OVERRIDING SYSTEM VALUE), so receipt numbers,
 * learner ids and every reference between rows stay exactly as they were.
 * Sessions are emptied: everyone signs in again, against the restored
 * accounts.
 */
export async function restoreBackup(pool: Pool, dir: string, manifest: BackupManifest, migrate: MigrateFn): Promise<RestoreResult> {
  const lockClient = await pool.connect();
  try {
    const locked = await lockClient.query('SELECT pg_try_advisory_lock($1) AS ok', [RESTORE_LOCK_KEY]);
    if (!locked.rows[0]?.ok) throw new Error('Another restore is already running.');

    await pool.query(`DROP SCHEMA IF EXISTS ${ident(STAGING_SCHEMA)} CASCADE`);
    try {
      await migrate({ schema: STAGING_SCHEMA, count: manifest.migrations.length });
      await loadIntoStaging(pool, dir, manifest);
      await migrate({ schema: STAGING_SCHEMA });
      return await replaceLiveData(pool);
    } finally {
      await pool.query(`DROP SCHEMA IF EXISTS ${ident(STAGING_SCHEMA)} CASCADE`).catch(() => {});
    }
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [RESTORE_LOCK_KEY]).catch(() => {});
    lockClient.release();
  }
}

async function loadIntoStaging(pool: Pool, dir: string, manifest: BackupManifest): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stagingTables = new Set(await listTables(client, STAGING_SCHEMA));
    const byName = new Map(manifest.tables.map((table) => [table.name, table]));

    for (const name of byName.keys()) {
      if (!stagingTables.has(name)) {
        throw new Error(`The backup has a table (${name}) that its own version of Ruzivo never created.`);
      }
    }

    // Tables the migrations seed themselves (004's default roles, say) must
    // hold exactly what the backup had, not the seed rows plus the backup's.
    const tablesInBackup = [...byName.keys()];
    if (tablesInBackup.length > 0) {
      await client.query(`TRUNCATE ${tablesInBackup.map((t) => qualified(STAGING_SCHEMA, t)).join(', ')} RESTART IDENTITY CASCADE`);
    }

    for (const tableName of await insertOrder(client, STAGING_SCHEMA, tablesInBackup)) {
      const table = byName.get(tableName)!;
      if (table.rows === 0) continue;

      const stagingColumns = new Set(
        (await listColumns(client, STAGING_SCHEMA, tableName)).filter((c) => !c.generated).map((c) => c.name)
      );
      const columns = table.columns.filter((column) => stagingColumns.has(column)).map(ident).join(', ');
      const body = await readFile(path.join(dir, table.file), 'utf8');
      const json = `[${body.split('\n').filter(Boolean).join(',')}]`;

      // Postgres parses the rows itself, so values arrive exactly as they
      // left: no JavaScript number or Date ever sits in between.
      await client.query(
        `INSERT INTO ${qualified(STAGING_SCHEMA, tableName)} (${columns}) OVERRIDING SYSTEM VALUE
         SELECT ${columns} FROM json_populate_recordset(NULL::${qualified(STAGING_SCHEMA, tableName)}, $1::json)`,
        [json]
      );
    }

    for (const sequence of manifest.sequences ?? []) {
      const exists = await client.query('SELECT to_regclass($1) IS NOT NULL AS ok', [qualified(STAGING_SCHEMA, sequence.name)]);
      if (exists.rows[0]?.ok) {
        await client.query('SELECT setval($1::regclass, $2::bigint, $3)', [qualified(STAGING_SCHEMA, sequence.name), sequence.lastValue, sequence.isCalled]);
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function replaceLiveData(pool: Pool): Promise<RestoreResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const liveMigrations = await appliedMigrations(client, 'public');
    const stagedMigrations = await appliedMigrations(client, STAGING_SCHEMA);
    if (liveMigrations.join('|') !== stagedMigrations.join('|')) {
      throw new Error('The restored data did not end up at the same version as this app, so nothing was replaced.');
    }

    const liveTables = await listTables(client, 'public');
    const stagedTables = new Set(await listTables(client, STAGING_SCHEMA));

    // Everything live goes, including tables the backup is too old to have
    // and the sessions table (never backed up): one statement, so foreign
    // keys between them are no obstacle.
    await client.query(
      `TRUNCATE ${[...liveTables, 'sessions'].filter((t, i, all) => all.indexOf(t) === i).map((t) => qualified('public', t)).join(', ')} RESTART IDENTITY CASCADE`
    );

    let rows = 0;
    const copied = (await insertOrder(client, 'public', liveTables)).filter((t) => stagedTables.has(t));
    for (const table of copied) {
      const liveColumns = (await listColumns(client, 'public', table)).filter((c) => !c.generated);
      const stagedNames = new Set((await listColumns(client, STAGING_SCHEMA, table)).map((c) => c.name));
      const columns = liveColumns.filter((c) => stagedNames.has(c.name)).map((c) => ident(c.name)).join(', ');

      const inserted = await client.query(
        `INSERT INTO ${qualified('public', table)} (${columns}) OVERRIDING SYSTEM VALUE
         SELECT ${columns} FROM ${qualified(STAGING_SCHEMA, table)}`
      );
      const expected = await client.query(`SELECT count(*)::int AS n FROM ${qualified(STAGING_SCHEMA, table)}`);
      if (inserted.rowCount !== expected.rows[0].n) {
        throw new Error(`Restoring ${table} copied ${inserted.rowCount} rows instead of ${expected.rows[0].n}; nothing was replaced.`);
      }
      rows += inserted.rowCount ?? 0;

      // New rows must carry on after the restored ids, not from 1.
      for (const column of liveColumns.filter((c) => c.identity)) {
        await client.query(
          `SELECT setval(pg_get_serial_sequence($1, $2), COALESCE((SELECT max(${ident(column.name)}) FROM ${qualified('public', table)}), 0) + 1, false)`,
          [qualified('public', table), column.name]
        );
      }
    }

    // Standalone sequences (document reference numbers) take the restored
    // position, so a new document never reuses an old number.
    for (const name of await standaloneSequences(client, 'public')) {
      const staged = await client.query('SELECT to_regclass($1) IS NOT NULL AS ok', [qualified(STAGING_SCHEMA, name)]);
      if (!staged.rows[0]?.ok) continue;
      const position = await client.query(`SELECT last_value::text AS last_value, is_called FROM ${qualified(STAGING_SCHEMA, name)}`);
      await client.query('SELECT setval($1::regclass, $2::bigint, $3)', [qualified('public', name), position.rows[0].last_value, position.rows[0].is_called]);
    }

    await client.query('COMMIT');
    return { tables: copied.length, rows };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
