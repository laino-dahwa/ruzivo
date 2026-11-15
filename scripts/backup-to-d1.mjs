#!/usr/bin/env node
/**
 * Converts a Ruzivo backup folder into files that load it into the Cloudflare
 * D1 mirror (cloud/d1/migrations/0001_initial.sql must already be applied).
 *
 *   node scripts/backup-to-d1.mjs "<backup folder>" [output folder]
 *
 * Output (default ./d1-import, which is git-ignored - it holds learners'
 * personal details and staff salaries):
 *   import.sql          every row, parents first, as idempotent upserts
 *   r2/logos/...        school logos, for the R2 bucket
 *   r2-upload.txt       the wrangler commands that upload them
 *   summary.json        row counts and money totals, to check the load
 *
 * The backup is checked first exactly as a restore would: every data file's
 * SHA-256 and row count must match manifest.json.
 *
 * Needs Node 22.18+ (runs electron/sync/normalize.ts directly).
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TABLE_ORDER, TABLES, normalizeRow, upsertStatements } from '../electron/sync/normalize.ts';

const [backupDir, outDir = 'd1-import'] = process.argv.slice(2);
if (!backupDir) {
  console.error('Usage: node scripts/backup-to-d1.mjs "<backup folder>" [output folder]');
  process.exit(1);
}

const manifest = JSON.parse(await readFile(path.join(backupDir, 'manifest.json'), 'utf8'));
if (manifest.format !== 'ruzivo-backup' || manifest.formatVersion !== 1) {
  throw new Error(`Not a Ruzivo backup this script understands (${manifest.format} v${manifest.formatVersion})`);
}

// ── Read and verify every table ────────────────────────────────────────────
/** @type {Map<string, Record<string, unknown>[]>} */
const raw = new Map();
for (const entry of manifest.tables) {
  const text = await readFile(path.join(backupDir, entry.file));
  const digest = createHash('sha256').update(text).digest('hex');
  if (digest !== entry.sha256) throw new Error(`${entry.file} has changed since the backup was made (SHA-256 mismatch)`);
  const rows = text
    .toString('utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
  if (rows.length !== entry.rows) throw new Error(`${entry.file}: expected ${entry.rows} rows, found ${rows.length}`);
  raw.set(entry.name, rows);
}

const unknown = [...raw.keys()].filter((t) => !TABLES[t]);
if (unknown.length > 0) {
  console.warn(`Not mirrored (no D1 table): ${unknown.join(', ')}`);
}

// ── Derived school_id for payments and expenses ────────────────────────────
const trim = (v) => (v == null ? null : String(v).replace(/ +$/, ''));
const learnerSchool = new Map((raw.get('learners') ?? []).map((l) => [l.learner_id, trim(l.school_id)]));
const chargeSchool = new Map((raw.get('charges') ?? []).map((c) => [c.charge_id, learnerSchool.get(c.learner_id) ?? null]));
const paymentSchool = new Map();
for (const a of raw.get('payment_allocations') ?? []) {
  if (!paymentSchool.has(a.payment_id)) paymentSchool.set(a.payment_id, chargeSchool.get(a.charge_id) ?? null);
}
const categorySchool = new Map(
  (raw.get('expense_categories') ?? []).map((c) => [c.expense_category_id, trim(c.school_id)])
);

function deriveSchoolId(table, row) {
  if (table === 'payments') return paymentSchool.get(row.payment_id) ?? null;
  if (table === 'expenses') return categorySchool.get(row.expense_category_id) ?? null;
  return undefined;
}

// ── Normalize and write ────────────────────────────────────────────────────
if (path.resolve(outDir) === path.resolve(backupDir)) throw new Error('The output folder must not be the backup folder');
await rm(outDir, { recursive: true, force: true });
await mkdir(path.join(outDir, 'r2'), { recursive: true });

const sql = [
  `-- Ruzivo backup import, made ${new Date().toISOString()}`,
  `-- From: ${path.basename(path.resolve(backupDir))} (app ${manifest.appVersion}, backed up ${manifest.createdAt})`,
  `-- Load with: npx wrangler d1 execute <database> --remote --file=${path.join(outDir, 'import.sql')}`,
  'PRAGMA defer_foreign_keys = true;',
  '',
];
const summary = { backup: manifest.createdAt, appVersion: manifest.appVersion, tables: {}, totals: {} };
const r2Commands = [];

for (const table of TABLE_ORDER) {
  const rows = raw.get(table) ?? [];
  summary.tables[table] = rows.length;
  if (rows.length === 0) continue;

  const out = [];
  for (const row of rows) {
    const { row: d1Row, blobs } = normalizeRow(table, row);
    if (TABLES[table].derivedSchoolId) d1Row.school_id = deriveSchoolId(table, row);
    out.push(d1Row);
    for (const blob of blobs) {
      const file = path.join(outDir, 'r2', ...blob.key.split('/'));
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, blob.bytes);
      r2Commands.push(
        `npx wrangler r2 object put "<bucket>/${blob.key}" --file="${file}" --content-type="${blob.contentType}" --remote`
      );
    }
  }

  // Every row of a table gets the same column order (derived columns last).
  const columns = [...new Set(out.flatMap((r) => Object.keys(r)))];
  const shaped = out.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null])));

  sql.push(`-- ${table}: ${rows.length} rows`);
  sql.push(...upsertStatements(table, shaped));
  sql.push('');
}

for (const [table, column] of [['payments', 'amount_cents'], ['expenses', 'amount_cents']]) {
  const rows = raw.get(table) ?? [];
  summary.totals[`${table}.${column}`] = rows.reduce((sum, r) => sum + (normalizeRow(table, r).row[column] ?? 0), 0);
}
const unassigned = (raw.get('payments') ?? []).filter((p) => !paymentSchool.get(p.payment_id)).length;
if (unassigned > 0) console.warn(`${unassigned} payment(s) have no allocation, so no school_id`);

await writeFile(path.join(outDir, 'import.sql'), sql.join('\n'));
await writeFile(path.join(outDir, 'r2-upload.txt'), r2Commands.join('\n') + '\n');
await writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');

console.log(`Wrote ${path.join(outDir, 'import.sql')}`);
for (const [table, count] of Object.entries(summary.tables)) if (count) console.log(`  ${table.padEnd(26)} ${count}`);
console.log(`  payments total               ${(summary.totals['payments.amount_cents'] / 100).toFixed(2)}`);
console.log(`  expenses total               ${(summary.totals['expenses.amount_cents'] / 100).toFixed(2)}`);
console.log(`\nNext:\n  npx wrangler d1 execute <database> --remote --file=${path.join(outDir, 'import.sql')}`);
console.log(`  then the ${r2Commands.length} logo upload(s) in ${path.join(outDir, 'r2-upload.txt')}`);
