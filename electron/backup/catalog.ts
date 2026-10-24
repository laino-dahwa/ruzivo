import type { ClientBase } from 'pg';
import { EXCLUDED_TABLES } from './format';

/** Quotes a schema/table/column name for direct use in SQL. */
export function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function qualified(schema: string, table: string): string {
  return `${ident(schema)}.${ident(table)}`;
}

export type ColumnInfo = { name: string; type: string; identity: boolean; generated: boolean };

/** Every application table in a schema, excluding the ones never backed up. */
export async function listTables(client: ClientBase, schema: string): Promise<string[]> {
  const result = await client.query(
    `
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relkind = 'r' AND NOT (c.relname = ANY($2::text[]))
    ORDER BY c.relname
    `,
    [schema, [...EXCLUDED_TABLES]]
  );
  return result.rows.map((row) => String(row.name));
}

export async function listColumns(client: ClientBase, schema: string, table: string): Promise<ColumnInfo[]> {
  const result = await client.query(
    `
    SELECT a.attname AS name,
           format_type(a.atttypid, a.atttypmod) AS type,
           a.attidentity <> '' AS identity,
           a.attgenerated <> '' AS generated
    FROM pg_attribute a
    WHERE a.attrelid = to_regclass($1) AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum
    `,
    [qualified(schema, table)]
  );
  return result.rows.map((row) => ({
    name: String(row.name),
    type: String(row.type),
    identity: row.identity === true,
    generated: row.generated === true,
  }));
}

/**
 * Tables ordered so every table comes after the tables its foreign keys point
 * at - the order rows must be inserted in. A table referencing itself is
 * fine (its rows go in as one statement, and foreign keys are only checked
 * at the end of a statement).
 */
export async function insertOrder(client: ClientBase, schema: string, tables: string[]): Promise<string[]> {
  const result = await client.query(
    `
    SELECT child.relname AS child, parent.relname AS parent
    FROM pg_constraint co
    JOIN pg_class child ON child.oid = co.conrelid
    JOIN pg_class parent ON parent.oid = co.confrelid
    JOIN pg_namespace n ON n.oid = child.relnamespace
    WHERE co.contype = 'f' AND n.nspname = $1
    `,
    [schema]
  );

  const wanted = new Set(tables);
  const parentsOf = new Map<string, Set<string>>(tables.map((t) => [t, new Set<string>()]));
  for (const row of result.rows) {
    const child = String(row.child);
    const parent = String(row.parent);
    if (child !== parent && wanted.has(child) && wanted.has(parent)) parentsOf.get(child)!.add(parent);
  }

  const ordered: string[] = [];
  const placed = new Set<string>();
  // Repeatedly place every table whose parents are all placed. Sorting each
  // round keeps the order stable from one run to the next.
  while (ordered.length < tables.length) {
    const ready = tables.filter((t) => !placed.has(t) && [...parentsOf.get(t)!].every((p) => placed.has(p))).sort();
    if (ready.length === 0) {
      throw new Error(`Cannot order tables for restore: circular foreign keys among ${tables.filter((t) => !placed.has(t)).join(', ')}`);
    }
    for (const table of ready) {
      ordered.push(table);
      placed.add(table);
    }
  }
  return ordered;
}

/** Applied migrations, in the order they ran. */
export async function appliedMigrations(client: ClientBase, schema: string): Promise<string[]> {
  const exists = await client.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [qualified(schema, 'pgmigrations')]);
  if (!exists.rows[0]?.ok) return [];
  const result = await client.query(`SELECT name FROM ${qualified(schema, 'pgmigrations')} ORDER BY run_on, id`);
  return result.rows.map((row) => String(row.name));
}

/** Sequences that are not behind an identity column - those are reset from the data instead. */
export async function standaloneSequences(client: ClientBase, schema: string): Promise<string[]> {
  const result = await client.query(
    `
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relkind = 'S'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'i')
    ORDER BY c.relname
    `,
    [schema]
  );
  return result.rows.map((row) => String(row.name));
}
