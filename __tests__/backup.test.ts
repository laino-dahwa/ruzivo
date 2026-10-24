import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client, Pool } from "pg";
import { runner } from "node-pg-migrate";
import { createBackup, sha256 } from "../electron/backup/create-backup";
import { availableMigrations, BackupProblem, readBackup } from "../electron/backup/read-backup";
import { restoreBackup, STAGING_SCHEMA, type MigrateFn } from "../electron/backup/restore-backup";
import { listTables, qualified } from "../electron/backup/catalog";
import { MANIFEST_FILE, XLSX_FILE, type BackupManifest } from "../electron/backup/format";

// Everything here runs in throwaway databases of its own, never the
// development database the other suites share: a restore empties every
// table it is pointed at, and the app's shared pool (lib/db) can outlive a
// test file within a worker, so it is not used at all.
const LIVE_DB = "ruzivo_backup_test";
const OLD_DB = "ruzivo_backup_test_old";
const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");

const connection = (database: string) => ({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database,
});

async function recreateDatabase(name: string) {
  const admin = new Client(connection(process.env.PGADMINDB || "postgres"));
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
}

async function dropDatabase(name: string) {
  const admin = new Client(connection(process.env.PGADMINDB || "postgres"));
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

function migratorFor(database: string): MigrateFn {
  return async ({ schema, count }) => {
    await runner({
      databaseUrl: connection(database),
      dir: MIGRATIONS_DIR,
      direction: "up",
      migrationsTable: "pgmigrations",
      schema,
      migrationsSchema: schema,
      createSchema: true,
      createMigrationsSchema: true,
      ...(count !== undefined ? { count } : {}),
      log: () => {},
    });
  };
}

/** A fingerprint of every row of every table, to compare whole databases. */
async function fingerprint(pool: Pool): Promise<Record<string, string>> {
  const client = await pool.connect();
  try {
    const out: Record<string, string> = {};
    for (const table of await listTables(client, "public")) {
      const result = await client.query(
        `SELECT count(*)::int AS n, md5(coalesce(string_agg(row_to_json(t)::text, E'\\n' ORDER BY row_to_json(t)::text), '')) AS h FROM ${qualified("public", table)} t`
      );
      out[table] = `${result.rows[0].n}:${result.rows[0].h}`;
    }
    return out;
  } finally {
    client.release();
  }
}

async function seed(pool: Pool, schoolId: string) {
  const one = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];
  await pool.query(`INSERT INTO schools (school_id, school_name) VALUES ($1, 'Backup Test Primary')`, [schoolId]);
  const gender = await one(`INSERT INTO genders (school_id, gender_name) VALUES ($1, 'Female') RETURNING gender_id`, [schoolId]);
  const klass = await one(`INSERT INTO class_categories (school_id, class_name) VALUES ($1, 'Grade 1') RETURNING class_category_id`, [schoolId]);
  const year = await one(`INSERT INTO academic_years (school_id, academic_year_name, start_date, end_date) VALUES ($1, '2026', '2026-01-01', '2026-12-31') RETURNING academic_year_id`, [schoolId]);
  const period = await one(`INSERT INTO payment_periods (school_id, period_name) VALUES ($1, 'January') RETURNING payment_period_id`, [schoolId]);
  const method = await one(`INSERT INTO payment_methods (school_id, method_name) VALUES ($1, 'Cash') RETURNING payment_method_id`, [schoolId]);
  const fee = await one(`INSERT INTO income_categories (school_id, income_name, income_limit) VALUES ($1, 'Tuition', 1234.56) RETURNING income_category_id`, [schoolId]);
  await pool.query(
    `INSERT INTO learners (learner_id, school_id, first_name, last_name, gender_id, date_of_birth) VALUES ('BT000001', $1, 'Rudo', 'Ncube', $2, '2016-03-04')`,
    [schoolId, gender.gender_id]
  );
  const enrolment = await one(
    `INSERT INTO enrolments (learner_id, class_category_id, academic_year_id) VALUES ('BT000001', $1, $2) RETURNING enrolment_id`,
    [klass.class_category_id, year.academic_year_id]
  );
  for (const amount of ["100.10", "0.01", "999999.99"]) {
    const charge = await one(
      `INSERT INTO charges (learner_id, enrolment_id, income_category_id, payment_period_id, academic_year_id) VALUES ('BT000001', $1, $2, $3, $4) RETURNING charge_id`,
      [enrolment.enrolment_id, fee.income_category_id, period.payment_period_id, year.academic_year_id]
    );
    const payment = await one(`INSERT INTO payments (amount, payment_method_id) VALUES ($1, $2) RETURNING payment_id`, [amount, method.payment_method_id]);
    await pool.query(`INSERT INTO payment_allocations (payment_id, charge_id) VALUES ($1, $2)`, [payment.payment_id, charge.charge_id]);
  }
  // Bytes that are not valid text, to prove binary columns survive exactly.
  await pool.query(`INSERT INTO school_logos (school_id, original, ico) VALUES ($1, $2, $3)`, [schoolId, Buffer.from([0, 255, 10, 13, 34, 92]), Buffer.from([1, 2, 3])]);
  // Advance the document reference sequence, so the restore must carry its position.
  await pool.query(`SELECT nextval('document_reference_seq') FROM generate_series(1, 7)`);
}

let pool: Pool;
let workDir: string;

beforeAll(async () => {
  await recreateDatabase(LIVE_DB);
  await migratorFor(LIVE_DB)({ schema: "public" });
  pool = new Pool({ ...connection(LIVE_DB), max: 4 });
  await seed(pool, "BKP1");
  workDir = await mkdtemp(path.join(os.tmpdir(), "ruzivo-backup-test-"));
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await dropDatabase(LIVE_DB);
  await dropDatabase(OLD_DB);
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

describe("creating a backup", () => {
  it("writes a verified folder with a manifest, a README, an Excel copy and one file per table", async () => {
    const result = await createBackup(pool, { parentDir: workDir, appVersion: "9.9.9", createdBy: "Test Admin" });

    expect(path.basename(result.path)).toMatch(/^Ruzivo backup \d{4}-\d{2}-\d{2} \d{4}$/);
    const manifest = JSON.parse(await readFile(path.join(result.path, MANIFEST_FILE), "utf8")) as BackupManifest;
    expect(manifest.createdBy).toBe("Test Admin");
    expect(manifest.migrations).toEqual(await availableMigrations(MIGRATIONS_DIR));
    expect(manifest.tables.map((t) => t.name)).not.toContain("sessions");
    expect(manifest.summary.counts.payments).toBe(3);
    expect(manifest.summary.schools).toEqual([{ school_id: "BKP1", school_name: "Backup Test Primary" }]);
    expect(manifest.sequences.find((s) => s.name === "document_reference_seq")?.lastValue).toBe("7");

    for (const table of manifest.tables) {
      expect(sha256(await readFile(path.join(result.path, table.file)))).toBe(table.sha256);
    }
    await expect(readFile(path.join(result.path, XLSX_FILE))).resolves.toBeTruthy();
  });

  it("never overwrites an earlier backup made in the same minute", async () => {
    const now = new Date("2026-10-24T09:30:00");
    const first = await createBackup(pool, { parentDir: workDir, appVersion: "9.9.9", createdBy: null, now, skipReadableCopy: true });
    const second = await createBackup(pool, { parentDir: workDir, appVersion: "9.9.9", createdBy: null, now, skipReadableCopy: true });
    expect(second.path).toBe(`${first.path} (2)`);
  });
});

describe("restoring a backup", () => {
  it("puts every table back exactly as it was, and new rows carry on after the restored ids", async () => {
    const before = await fingerprint(pool);
    const backup = await createBackup(pool, { parentDir: workDir, appVersion: "9.9.9", createdBy: null, skipReadableCopy: true });

    // Things that happen after the backup, which the restore must undo.
    await pool.query(`INSERT INTO payments (amount) VALUES (5)`);
    await pool.query(`UPDATE learners SET first_name = 'Changed'`);
    await pool.query(`DELETE FROM school_logos`);
    await pool.query(`SELECT nextval('document_reference_seq')`);

    const manifest = await readBackup(backup.path, MIGRATIONS_DIR);
    await restoreBackup(pool, backup.path, manifest, migratorFor(LIVE_DB));

    expect(await fingerprint(pool)).toEqual(before);

    const logo = await pool.query(`SELECT original FROM school_logos WHERE school_id = 'BKP1'`);
    expect([...logo.rows[0].original]).toEqual([0, 255, 10, 13, 34, 92]);
    const amounts = await pool.query(`SELECT amount::text FROM payments ORDER BY payment_id`);
    expect(amounts.rows.map((r) => r.amount)).toEqual(["100.10", "0.01", "999999.99"]);

    const next = await pool.query(`INSERT INTO payments (amount) VALUES (1) RETURNING payment_id`);
    expect(Number(next.rows[0].payment_id)).toBe(4);
    const nextRef = await pool.query(`SELECT nextval('document_reference_seq')::int AS n`);
    expect(nextRef.rows[0].n).toBe(8);
    await pool.query(`DELETE FROM payments WHERE payment_id = 4`);

    const staging = await pool.query(`SELECT 1 FROM pg_namespace WHERE nspname = $1`, [STAGING_SCHEMA]);
    expect(staging.rowCount).toBe(0);
  }, 60_000);

  it("signs everyone out", async () => {
    const role = await pool.query(`INSERT INTO roles (school_id, role_name) VALUES ('BKP1', 'Signed in role') RETURNING role_id`);
    const employee = await pool.query(
      `INSERT INTO employees (school_id, first_name, last_name, email, password_hash, role_id) VALUES ('BKP1', 'Sam', 'Session', 'sam@example.test', 'x', $1) RETURNING employee_id`,
      [role.rows[0].role_id]
    );
    const backup = await createBackup(pool, { parentDir: workDir, appVersion: "9.9.9", createdBy: null, skipReadableCopy: true });
    await pool.query(
      `INSERT INTO sessions (token_hash, employee_id, active_school_id, expires_at, absolute_expires_at) VALUES (repeat('a', 64), $1, 'BKP1', now() + interval '1 day', now() + interval '1 day')`,
      [employee.rows[0].employee_id]
    );

    await restoreBackup(pool, backup.path, await readBackup(backup.path, MIGRATIONS_DIR), migratorFor(LIVE_DB));

    expect((await pool.query(`SELECT count(*)::int AS n FROM sessions`)).rows[0].n).toBe(0);
    expect((await pool.query(`SELECT count(*)::int AS n FROM employees WHERE email = 'sam@example.test'`)).rows[0].n).toBe(1);
  }, 60_000);

  it("brings a backup made by an older version up to date", async () => {
    const all = await availableMigrations(MIGRATIONS_DIR);
    await recreateDatabase(OLD_DB);
    await migratorFor(OLD_DB)({ schema: "public", count: all.length - 1 });
    const oldPool = new Pool({ ...connection(OLD_DB), max: 2 });
    let oldBackupPath: string;
    try {
      await oldPool.query(`INSERT INTO schools (school_id, school_name) VALUES ('OLD1', 'From An Older Version')`);
      oldBackupPath = (await createBackup(oldPool, { parentDir: workDir, appVersion: "0.0.1", createdBy: null, skipReadableCopy: true })).path;
    } finally {
      await oldPool.end();
    }

    const manifest = await readBackup(oldBackupPath, MIGRATIONS_DIR);
    expect(manifest.migrations).toHaveLength(all.length - 1);
    await restoreBackup(pool, oldBackupPath, manifest, migratorFor(LIVE_DB));

    const schools = await pool.query(`SELECT school_id FROM schools ORDER BY school_id`);
    expect(schools.rows.map((r) => r.school_id.trim())).toEqual(["OLD1"]);
    const migrations = await pool.query(`SELECT count(*)::int AS n FROM pgmigrations`);
    expect(migrations.rows[0].n).toBe(all.length);
  }, 120_000);
});

describe("refusing a backup that is not safe to restore", () => {
  let good: string;
  let goodFingerprint: Record<string, string>;

  beforeAll(async () => {
    // The previous suite left the live database at the "old version" backup;
    // put real data back so a refused restore has something to protect.
    await pool.query(`TRUNCATE schools CASCADE`);
    await seed(pool, "BKP2");
    good = (await createBackup(pool, { parentDir: workDir, appVersion: "9.9.9", createdBy: null, skipReadableCopy: true })).path;
    goodFingerprint = await fingerprint(pool);
  }, 60_000);

  async function copyOfGood(name: string) {
    const copy = path.join(workDir, name);
    await cp(good, copy, { recursive: true });
    return copy;
  }

  it("refuses a folder that isn't a backup", async () => {
    await expect(readBackup(workDir, MIGRATIONS_DIR)).rejects.toThrow(/isn't a Ruzivo backup/);
  });

  it("refuses a backup whose data was edited after it was made", async () => {
    const copy = await copyOfGood("tampered");
    const file = path.join(copy, "data", "payments.jsonl");
    await writeFile(file, (await readFile(file, "utf8")).replace("100.10", "900.10"));
    await expect(readBackup(copy, MIGRATIONS_DIR)).rejects.toThrow(BackupProblem);
    await expect(readBackup(copy, MIGRATIONS_DIR)).rejects.toThrow(/changed or damaged/);
  });

  it("refuses a backup made by a newer version of the app", async () => {
    const copy = await copyOfGood("newer");
    const manifest = JSON.parse(await readFile(path.join(copy, MANIFEST_FILE), "utf8"));
    manifest.migrations.push("999_from_the_future");
    manifest.appVersion = "9.0.0";
    await writeFile(path.join(copy, MANIFEST_FILE), JSON.stringify(manifest));
    await expect(readBackup(copy, MIGRATIONS_DIR)).rejects.toThrow(/newer version of Ruzivo \(9\.0\.0\)/);
  });

  it("leaves the current data untouched when a restore fails part-way", async () => {
    // A row that passes the fingerprint check (it is re-fingerprinted) but
    // breaks a foreign key, so loading it fails inside the restore.
    const copy = await copyOfGood("broken");
    const manifestPath = path.join(copy, MANIFEST_FILE);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as BackupManifest;
    const allocations = manifest.tables.find((t) => t.name === "payment_allocations")!;
    const file = path.join(copy, allocations.file);
    const body = (await readFile(file, "utf8")).replace(/"charge_id":\d+/, '"charge_id":987654');
    await writeFile(file, body);
    allocations.sha256 = sha256(body);
    await writeFile(manifestPath, JSON.stringify(manifest));

    const checked = await readBackup(copy, MIGRATIONS_DIR);
    await expect(restoreBackup(pool, copy, checked, migratorFor(LIVE_DB))).rejects.toThrow();
    expect(await fingerprint(pool)).toEqual(goodFingerprint);
  }, 60_000);
});
