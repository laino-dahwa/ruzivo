/**
 * Turns a Ruzivo Postgres row (as `row_to_json` renders it, i.e. exactly what
 * a backup's data/<table>.jsonl holds) into the row shape the Cloudflare D1
 * mirror stores. Used by both the one-off backup import
 * (scripts/backup-to-d1.mjs) and the live desktop sync, so both produce
 * identical rows.
 *
 * Self-contained on purpose (no imports): the import script runs this file
 * directly with Node's TypeScript support, outside the Electron build.
 *
 *   CHAR(n) ids      -> TEXT, trailing pad spaces trimmed ("SSV " -> "SSV")
 *   NUMERIC(12,2)    -> INTEGER cents, column renamed <name>_cents
 *   TIMESTAMPTZ      -> TEXT, UTC ISO-8601 with microseconds ("...Z")
 *   DATE             -> TEXT "YYYY-MM-DD" (unchanged)
 *   BOOLEAN          -> INTEGER 0/1
 *   JSONB            -> TEXT (JSON string)
 *   BYTEA            -> not stored in D1; returned separately as blobs for R2
 *   password / security key hashes -> dropped, never leave the computer
 */

export const SYNC_FORMAT = 'ruzivo-sync';
export const SYNC_FORMAT_VERSION = 1;

export type TableSpec = {
  /** Primary key columns, in D1 column names. */
  pk: string[];
  /** CHAR(n) columns whose pad spaces are trimmed. */
  char?: string[];
  /** NUMERIC money columns, stored as <name>_cents. */
  money?: string[];
  timestamps?: string[];
  booleans?: string[];
  json?: string[];
  /** BYTEA columns: removed from the row and handed back as blobs for R2. */
  bytea?: string[];
  /** Columns that are never mirrored. */
  exclude?: string[];
  /** The mirror adds a school_id the Postgres table does not have. */
  derivedSchoolId?: boolean;
};

/**
 * Every mirrored table, parents before children (the order rows are written
 * in). Tables not listed here (sessions, pgmigrations) are never mirrored.
 */
export const TABLES: Record<string, TableSpec> = {
  schools: { pk: ['school_id'], char: ['school_id'], timestamps: ['created_at'] },
  genders: { pk: ['gender_id'], char: ['school_id'] },
  payment_methods: { pk: ['payment_method_id'], char: ['school_id'] },
  class_categories: { pk: ['class_category_id'], char: ['school_id'] },
  payment_periods: { pk: ['payment_period_id'], char: ['school_id'] },
  expense_categories: { pk: ['expense_category_id'], char: ['school_id'] },
  income_categories: { pk: ['income_category_id'], char: ['school_id'], money: ['income_limit'] },
  academic_years: { pk: ['academic_year_id'], char: ['school_id'] },
  roles: { pk: ['role_id'], char: ['school_id'] },
  employees: {
    pk: ['employee_id'],
    char: ['school_id'],
    money: ['basic_salary', 'transport_allowance', 'housing_allowance', 'paye_deduction', 'pension_deduction'],
    timestamps: ['created_at', 'deleted_at', 'last_login_at', 'locked_until', 'security_key_created_at'],
    booleans: ['must_change_password'],
    exclude: ['password_hash', 'security_key_hash'],
  },
  learners: {
    pk: ['learner_id'],
    char: ['school_id'],
    timestamps: ['created_at', 'updated_at', 'deleted_at'],
  },
  enrolments: { pk: ['enrolment_id'] },
  income_category_classes: { pk: ['income_category_class_id'] },
  income_category_learners: { pk: ['income_category_learner_id'] },
  income_category_periods: { pk: ['income_category_period_id'] },
  charges: { pk: ['charge_id'], timestamps: ['created_at'] },
  fee_decisions: { pk: ['fee_decision_id'], char: ['school_id'], money: ['amount'], timestamps: ['decided_at'] },
  fee_exemptions: { pk: ['fee_exemption_id'], char: ['school_id'], timestamps: ['exempted_at'] },
  payments: { pk: ['payment_id'], money: ['amount'], timestamps: ['paid_at'], derivedSchoolId: true },
  payment_allocations: { pk: ['allocation_id'] },
  expenses: { pk: ['expense_id'], money: ['amount'], timestamps: ['created_at'], derivedSchoolId: true },
  payroll_runs: { pk: ['payroll_run_id'], char: ['school_id'], timestamps: ['generated_at'] },
  payroll_lines: {
    pk: ['payroll_line_id'],
    money: ['basic_salary', 'transport_allowance', 'housing_allowance', 'paye_deduction', 'pension_deduction'],
  },
  documents: {
    pk: ['document_id'],
    char: ['school_id'],
    timestamps: ['issued_at'],
    json: ['statement_data', 'invoice_data'],
  },
  audit_log: { pk: ['audit_id'], char: ['school_id'], timestamps: ['occurred_at'], json: ['detail'] },
  school_logos: { pk: ['school_id'], char: ['school_id'], timestamps: ['updated_at'], bytea: ['original', 'ico'] },
  school_logo_renditions: { pk: ['school_id', 'size'], char: ['school_id'], bytea: ['png'] },
};

/** Parents first: the order rows are inserted in. Deletes go in reverse. */
export const TABLE_ORDER = Object.keys(TABLES);

export type D1Value = string | number | null;
export type D1Row = Record<string, D1Value>;
export type Blob = { key: string; contentType: string; bytes: Buffer };

/** "85.00" / 85 / 85.5 -> 8500 / 8500 / 8550, without float arithmetic. */
export function toCents(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  // String() of a JSON-parsed NUMERIC(12,2) is its shortest exact decimal form.
  const text = typeof value === 'number' ? String(value) : String(value).trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error(`Not a 2-decimal money value: ${text}`);
  const [, sign, whole, frac = ''] = match;
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return sign === '-' ? -cents : cents;
}

/** "2026-09-10T09:27:41.58366+02:00" -> "2026-09-10T07:27:41.583660Z". */
export function toUtcTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error(`Not a timestamp: ${text}`);
  const micros = (/\.(\d+)/.exec(text)?.[1] ?? '').slice(0, 6).padEnd(6, '0');
  return date.toISOString().replace(/\.\d{3}Z$/, `.${micros}Z`);
}

/** Postgres BYTEA hex text ("\x8950...") -> bytes. */
export function fromByteaHex(value: unknown): Buffer {
  const text = String(value);
  if (!text.startsWith('\\x')) throw new Error('BYTEA value is not in hex format');
  return Buffer.from(text.slice(2), 'hex');
}

export function trimChar(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value).replace(/ +$/, '');
}

function sniffImageType(bytes: Buffer, fallback: string): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01) return 'image/x-icon';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  return fallback;
}

/** R2 key for a logo blob, so the D1 row can point at it. */
function blobKey(table: string, row: Record<string, unknown>, column: string): string {
  const school = trimChar(row.school_id);
  if (table === 'school_logo_renditions') return `logos/${school}/r${row.size}.png`;
  return `logos/${school}/${column === 'ico' ? 'logo.ico' : 'original'}`;
}

/**
 * Converts one Postgres row to its D1 shape. Columns the spec does not know
 * about are passed through as-is (a later migration adding a plain column
 * keeps syncing), except objects, which are stored as JSON text.
 */
export function normalizeRow(table: string, row: Record<string, unknown>): { row: D1Row; blobs: Blob[] } {
  const spec = TABLES[table];
  if (!spec) throw new Error(`Table ${table} is not mirrored`);
  const out: D1Row = {};
  const blobs: Blob[] = [];

  for (const [column, value] of Object.entries(row)) {
    if (spec.exclude?.includes(column)) continue;
    if (spec.bytea?.includes(column)) {
      if (value === null || value === undefined) {
        out[`${column}_r2_key`] = null;
        continue;
      }
      const bytes = fromByteaHex(value);
      const key = blobKey(table, row, column);
      const declared = typeof row.content_type === 'string' ? row.content_type : 'application/octet-stream';
      blobs.push({ key, contentType: sniffImageType(bytes, declared), bytes });
      out[`${column}_r2_key`] = key;
      continue;
    }
    if (spec.money?.includes(column)) out[`${column}_cents`] = toCents(value);
    else if (spec.char?.includes(column)) out[column] = trimChar(value);
    else if (spec.timestamps?.includes(column)) out[column] = toUtcTimestamp(value);
    else if (spec.booleans?.includes(column)) out[column] = value === null || value === undefined ? null : value ? 1 : 0;
    else if (spec.json?.includes(column)) out[column] = value === null || value === undefined ? null : JSON.stringify(value);
    else if (value === null || value === undefined) out[column] = null;
    else if (typeof value === 'object') out[column] = JSON.stringify(value);
    else if (typeof value === 'boolean') out[column] = value ? 1 : 0;
    else out[column] = value as string | number;
  }
  return { row: out, blobs };
}

/** The primary key of a D1-shaped row, e.g. { payment_id: 7 }. */
export function primaryKey(table: string, row: D1Row): D1Row {
  const key: D1Row = {};
  for (const column of TABLES[table].pk) key[column] = row[column] ?? null;
  return key;
}

// ---------------------------------------------------------------------------
// The transfer format sent to the Worker (and produced by the backup import).

export type SyncChange =
  | { table: string; op: 'upsert'; rows: D1Row[] }
  | { table: string; op: 'delete'; keys: D1Row[] };

export type SyncBatch = {
  format: typeof SYNC_FORMAT;
  version: typeof SYNC_FORMAT_VERSION;
  installId: string;
  appVersion: string;
  /** Last Postgres migration applied; the Worker refuses schemas it does not know. */
  schemaMigration: string;
  batchId: string;
  createdAt: string;
  mode: 'delta' | 'full';
  /**
   * Full mode only. A full sync is a 'start' batch, any number of 'rows'
   * batches (every row of every table), then a 'finish' batch, all with the
   * same syncId. On 'finish' the Worker deletes every row the full sync did
   * not send (its _synced_at is older than the 'start').
   */
  full?: { syncId: string; phase: 'start' | 'rows' | 'finish' };
  changes: SyncChange[];
  /** Logos for R2, base64. */
  blobs?: { key: string; contentType: string; base64: string }[];
};

/** What the Worker answers to a batch. */
export type SyncResponse =
  | { ok: true; applied: number; duplicate?: boolean }
  | { ok: false; error: string; code?: 'schema' | 'auth' | 'revoked' | 'bad-request' | 'full-sync' };

// ---------------------------------------------------------------------------
// SQL generation, for `wrangler d1 execute --file` (backup import).

export function sqlLiteral(value: D1Value): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Cannot write ${value} to SQL`);
    return String(value);
  }
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Multi-row upserts, split so no statement exceeds maxBytes (D1 caps a
 * statement at 100 KB). Every row of a table must have the same columns.
 */
export function upsertStatements(table: string, rows: D1Row[], maxBytes = 90_000): string[] {
  if (rows.length === 0) return [];
  const columns = Object.keys(rows[0]);
  const pk = TABLES[table].pk;
  const updates = columns.filter((c) => !pk.includes(c));
  const head = `INSERT INTO ${table} (${columns.join(', ')}) VALUES\n`;
  const tail =
    updates.length > 0
      ? `\nON CONFLICT (${pk.join(', ')}) DO UPDATE SET ${updates.map((c) => `${c} = excluded.${c}`).join(', ')};`
      : `\nON CONFLICT (${pk.join(', ')}) DO NOTHING;`;

  const statements: string[] = [];
  let values: string[] = [];
  let size = head.length + tail.length;
  for (const row of rows) {
    const tuple = `(${columns.map((c) => sqlLiteral(row[c] ?? null)).join(', ')})`;
    if (values.length > 0 && size + tuple.length + 2 > maxBytes) {
      statements.push(head + values.join(',\n') + tail);
      values = [];
      size = head.length + tail.length;
    }
    values.push(tuple);
    size += tuple.length + 2;
  }
  statements.push(head + values.join(',\n') + tail);
  return statements;
}
