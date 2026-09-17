import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runner } from "node-pg-migrate";
import path from "node:path";
import { Pool } from "pg";

// Exercises migrations/ against a genuinely fresh, empty database — the
// exact scenario a new desktop install (or a from-scratch web deploy) goes
// through. This is what originally caught three real, otherwise-invisible
// bugs during development: a table-creation-order bug, a column-name drift
// (academic_years), and missing school_id columns + missing ON DELETE
// CASCADE on several foreign keys — all invisible when testing only against
// the shared dev database, which had already been patched by hand at some
// point in the past without the DDL ever being updated to match.
const TEST_DATABASE = "ruzivo_migrations_test";
const migrationsDir = path.join(__dirname, "..", "migrations");

function adminConfig() {
  return {
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGADMINDB || "postgres",
  };
}

function testDbConfig() {
  return {
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: TEST_DATABASE,
  };
}

async function recreateTestDatabase() {
  const admin = new Pool(adminConfig());
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DATABASE}`);
    await admin.query(`CREATE DATABASE ${TEST_DATABASE}`);
  } finally {
    await admin.end();
  }
}

async function dropTestDatabase() {
  const admin = new Pool(adminConfig());
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DATABASE}`);
  } finally {
    await admin.end();
  }
}

beforeAll(recreateTestDatabase);
afterAll(dropTestDatabase);

describe("migrations — fresh database", () => {
  it("applies cleanly against a genuinely empty database", async () => {
    const applied = await runner({
      databaseUrl: testDbConfig(),
      dir: migrationsDir,
      direction: "up",
      migrationsTable: "pgmigrations",
      log: () => {},
    });
    // Asserted in order and in full: a migration that stops being applied,
    // or one that lands out of sequence, is exactly the failure this catches.
    expect(applied.map((m) => m.name)).toEqual(["001_initial_schema", "002_school_logos", "003_employees", "004_roles", "005_income_category_applicability"]);
  });

  it("creates every table the application code depends on", async () => {
    const pool = new Pool(testDbConfig());
    const result = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name != 'pgmigrations' ORDER BY table_name"
    );
    await pool.end();
    expect(result.rows.map((r) => r.table_name)).toEqual([
      "academic_years",
      "charges",
      "class_categories",
      "employees",
      "enrolments",
      "expense_categories",
      "expenses",
      "genders",
      "income_categories",
      "income_category_classes",
      "income_category_learners",
      "income_category_periods",
      "learners",
      "payment_allocations",
      "payment_methods",
      "payment_periods",
      "payments",
      "roles",
      "school_logo_renditions",
      "school_logos",
      "schools",
    ]);
  });

  it("gives genders and payment_methods a school_id column (repositories filter/insert by it)", async () => {
    const pool = new Pool(testDbConfig());
    const genderCols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'genders'");
    const methodCols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'payment_methods'");
    await pool.end();
    expect(genderCols.rows.map((r) => r.column_name)).toContain("school_id");
    expect(methodCols.rows.map((r) => r.column_name)).toContain("school_id");
  });

  it("uses academic_year_name (not name), matching every repository query", async () => {
    const pool = new Pool(testDbConfig());
    const cols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'academic_years'");
    await pool.end();
    const names = cols.rows.map((r) => r.column_name);
    expect(names).toContain("academic_year_name");
    expect(names).not.toContain("name");
  });

  it("deletes a school and cascades to its reference data (deleteSchool() does no manual child cleanup)", async () => {
    const pool = new Pool(testDbConfig());
    await pool.query("INSERT INTO schools (school_id, school_name) VALUES ('ZZZ', 'Cascade Check')");
    await pool.query("INSERT INTO genders (school_id, gender_name) VALUES ('ZZZ', 'X')");
    await pool.query("INSERT INTO payment_methods (school_id, method_name) VALUES ('ZZZ', 'X')");
    await pool.query("INSERT INTO class_categories (school_id, class_name) VALUES ('ZZZ', 'X')");

    await expect(pool.query("DELETE FROM schools WHERE school_id = 'ZZZ'")).resolves.toBeDefined();

    const remaining = await pool.query("SELECT (SELECT count(*) FROM genders WHERE school_id = 'ZZZ') + (SELECT count(*) FROM payment_methods WHERE school_id = 'ZZZ') + (SELECT count(*) FROM class_categories WHERE school_id = 'ZZZ') AS total");
    expect(Number(remaining.rows[0].total)).toBe(0);
    await pool.end();
  });

  it("deletes a school in one statement even when a fee's applicability names its own classes/periods (two independent cascade paths converging on the same join row)", async () => {
    const pool = new Pool(testDbConfig());
    await pool.query("INSERT INTO schools (school_id, school_name) VALUES ('ZZY', 'Cascade Check 2')");
    const classResult = await pool.query("INSERT INTO class_categories (school_id, class_name) VALUES ('ZZY', 'X') RETURNING class_category_id");
    const periodResult = await pool.query("INSERT INTO payment_periods (school_id, period_name) VALUES ('ZZY', 'X') RETURNING payment_period_id");
    const categoryResult = await pool.query(
      "INSERT INTO income_categories (school_id, income_name, class_applicability, period_applicability) VALUES ('ZZY', 'X', 'SPECIFIC_CLASSES', 'SPECIFIC_PERIODS') RETURNING income_category_id"
    );
    const incomeCategoryId = categoryResult.rows[0].income_category_id;
    await pool.query("INSERT INTO income_category_classes (income_category_id, class_category_id) VALUES ($1, $2)", [incomeCategoryId, classResult.rows[0].class_category_id]);
    await pool.query("INSERT INTO income_category_periods (income_category_id, payment_period_id) VALUES ($1, $2)", [incomeCategoryId, periodResult.rows[0].payment_period_id]);

    // schools -> class_categories and schools -> income_categories -> income_category_classes
    // both terminate at income_category_classes; without ON DELETE CASCADE on
    // income_category_classes' own FK to class_categories (and the equivalent
    // for periods), this failed with "violates foreign key constraint
    // fk_icc_class_category" — Postgres does not reliably finish the second,
    // longer cascade path before the first path's row-level check runs.
    await expect(pool.query("DELETE FROM schools WHERE school_id = 'ZZY'")).resolves.toBeDefined();

    const remaining = await pool.query(
      "SELECT (SELECT count(*) FROM class_categories WHERE school_id = 'ZZY') + (SELECT count(*) FROM payment_periods WHERE school_id = 'ZZY') + (SELECT count(*) FROM income_categories WHERE school_id = 'ZZY') AS total"
    );
    expect(Number(remaining.rows[0].total)).toBe(0);
    await pool.end();
  });

  it("running migrations again is a no-op (idempotent)", async () => {
    const applied = await runner({
      databaseUrl: testDbConfig(),
      dir: migrationsDir,
      direction: "up",
      migrationsTable: "pgmigrations",
      log: () => {},
    });
    expect(applied).toHaveLength(0);
  });
});
