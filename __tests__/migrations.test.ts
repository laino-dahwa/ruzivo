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
    expect(applied.map((m) => m.name)).toEqual(["001_initial_schema", "002_school_logos", "003_employees", "004_roles", "005_income_category_applicability", "006_auth_and_audit", "007_documents", "008_payroll", "009_performance_indexes", "010_document_invoices", "011_once_off_income", "012_security_keys"]);
  });

  it("creates every table the application code depends on", async () => {
    const pool = new Pool(testDbConfig());
    const result = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name != 'pgmigrations' ORDER BY table_name"
    );
    await pool.end();
    expect(result.rows.map((r) => r.table_name)).toEqual([
      "academic_years",
      "audit_log",
      "charges",
      "class_categories",
      "documents",
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
      "payroll_lines",
      "payroll_runs",
      "roles",
      "school_logo_renditions",
      "school_logos",
      "schools",
      "sessions",
    ]);
  });

  it("ships no seeded administrator and no default password", async () => {
    const pool = new Pool(testDbConfig());
    const employees = await pool.query("SELECT count(*) AS total FROM employees");
    const adminRoles = await pool.query("SELECT count(*) AS total FROM roles WHERE access_level = 'ADMIN'");
    await pool.end();
    // 006 must never insert an account. The first administrator is created by
    // POST /api/auth/bootstrap with a password the user chooses.
    expect(Number(employees.rows[0].total)).toBe(0);
    expect(Number(adminRoles.rows[0].total)).toBe(0);
  });

  it("defaults every role to the lower access level", async () => {
    const pool = new Pool(testDbConfig());
    await pool.query("INSERT INTO schools (school_id, school_name) VALUES ('ZZL', 'Least Privilege')");
    const role = await pool.query("INSERT INTO roles (school_id, role_name) VALUES ('ZZL', 'Head') RETURNING access_level");
    await pool.query("DELETE FROM schools WHERE school_id = 'ZZL'");
    await pool.end();
    // Roles that already existed before 006 (and any created without naming a
    // level) must land least-privilege, so migrating never grants admin.
    expect(role.rows[0].access_level).toBe("CASHIER");
  });

  it("deletes a school in one statement even when its staff recorded payments and audit entries", async () => {
    const pool = new Pool(testDbConfig());
    await pool.query("INSERT INTO schools (school_id, school_name) VALUES ('ZZA', 'Audit Cascade')");
    const roleResult = await pool.query("INSERT INTO roles (school_id, role_name, access_level) VALUES ('ZZA', 'Administrator', 'ADMIN') RETURNING role_id");
    const employeeResult = await pool.query(
      "INSERT INTO employees (school_id, first_name, last_name, email, password_hash, role_id) VALUES ('ZZA', 'A', 'B', 'ab@zza.school', 'scrypt$1$x$y', $1) RETURNING employee_id",
      [roleResult.rows[0].role_id]
    );
    const employeeId = employeeResult.rows[0].employee_id;

    await pool.query(
      "INSERT INTO sessions (employee_id, token_hash, active_school_id, expires_at, absolute_expires_at) VALUES ($1, repeat('a', 64), 'ZZA', now() + interval '1 hour', now() + interval '1 day')",
      [employeeId]
    );
    await pool.query(
      "INSERT INTO audit_log (employee_id, actor_label, school_id, action, entity_type, summary) VALUES ($1, 'A B', 'ZZA', 'payment.create', 'payment', 'recorded a payment')",
      [employeeId]
    );

    // schools -> employees cascades. If audit_log.employee_id restricted
    // instead of SET NULL, this single statement would fail outright for any
    // school whose staff had ever done anything worth logging.
    await expect(pool.query("DELETE FROM schools WHERE school_id = 'ZZA'")).resolves.toBeDefined();

    // The audit entry survives the school it describes, with the actor's name
    // preserved even though the employee row is gone.
    const audit = await pool.query("SELECT employee_id, actor_label FROM audit_log WHERE school_id = 'ZZA'");
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].employee_id).toBeNull();
    expect(audit.rows[0].actor_label).toBe("A B");

    await pool.query("DELETE FROM audit_log WHERE school_id = 'ZZA'");
    await pool.end();
  });

  it("keeps a payment when the employee who recorded it is deleted", async () => {
    const pool = new Pool(testDbConfig());
    await pool.query("INSERT INTO schools (school_id, school_name) VALUES ('ZZP', 'Recorder Check')");
    const roleResult = await pool.query("INSERT INTO roles (school_id, role_name) VALUES ('ZZP', 'Cashier') RETURNING role_id");
    const employeeResult = await pool.query(
      "INSERT INTO employees (school_id, first_name, last_name, email, password_hash, role_id) VALUES ('ZZP', 'C', 'D', 'cd@zzp.school', 'scrypt$1$x$y', $1) RETURNING employee_id",
      [roleResult.rows[0].role_id]
    );
    const methodResult = await pool.query("INSERT INTO payment_methods (school_id, method_name) VALUES ('ZZP', 'Cash') RETURNING payment_method_id");
    const paymentResult = await pool.query(
      "INSERT INTO payments (amount, payment_method_id, recorded_by_employee_id) VALUES (10, $1, $2) RETURNING payment_id",
      [methodResult.rows[0].payment_method_id, employeeResult.rows[0].employee_id]
    );

    await pool.query("DELETE FROM employees WHERE employee_id = $1", [employeeResult.rows[0].employee_id]);

    // SET NULL, not CASCADE: losing the recorder must never take the money
    // record with it.
    const payment = await pool.query("SELECT recorded_by_employee_id FROM payments WHERE payment_id = $1", [paymentResult.rows[0].payment_id]);
    expect(payment.rows).toHaveLength(1);
    expect(payment.rows[0].recorded_by_employee_id).toBeNull();

    await pool.query("DELETE FROM payments WHERE payment_id = $1", [paymentResult.rows[0].payment_id]);
    await pool.query("DELETE FROM schools WHERE school_id = 'ZZP'");
    await pool.end();
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

  it("indexes the foreign keys and sort columns the payment/expense lists depend on (009)", async () => {
    const pool = new Pool(testDbConfig());
    const result = await pool.query("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'");
    await pool.end();
    expect(result.rows.map((r) => r.indexname)).toEqual(expect.arrayContaining([
      "idx_learners_school_live",
      "idx_charges_learner_fee_period",
      "idx_charges_enrolment",
      "idx_charges_income_category",
      "idx_payment_allocations_charge",
      "idx_payments_paid_at",
      "idx_expenses_category_date",
      "idx_expenses_date",
      "idx_enrolments_year_class",
    ]));
  });

  it("rolls every migration after 008 back cleanly and re-applies them", async () => {
    // Every file after 008, so this keeps covering new migrations without edits.
    const { readdirSync } = await import("node:fs");
    const later = readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql") && file > "008_payroll.sql")
      .map((file) => file.replace(/\.sql$/, ""))
      .sort();

    // A once-off fee has to survive the rollback of 011 as something the old
    // constraint accepts.
    const setup = new Pool(testDbConfig());
    await setup.query("INSERT INTO schools (school_id, school_name) VALUES ('ZZR', 'Rollback Check')");
    await setup.query("INSERT INTO income_categories (school_id, income_name, priority) VALUES ('ZZR', 'Registration', 'ONCE_OFF')");
    await setup.end();

    const down = await runner({ databaseUrl: testDbConfig(), dir: migrationsDir, direction: "down", count: later.length, migrationsTable: "pgmigrations", log: () => {} });
    expect(down.map((m) => m.name)).toEqual([...later].reverse());

    const pool = new Pool(testDbConfig());
    const left = await pool.query("SELECT count(*) AS total FROM pg_indexes WHERE indexname = 'idx_payments_paid_at'");
    const columns = await pool.query(
      "SELECT count(*) AS total FROM information_schema.columns WHERE (table_name = 'documents' AND column_name = 'invoice_data') OR (table_name = 'employees' AND column_name = 'security_key_hash')"
    );
    const fee = await pool.query("SELECT priority FROM income_categories WHERE school_id = 'ZZR'");
    await pool.query("DELETE FROM schools WHERE school_id = 'ZZR'");
    await pool.end();
    expect(Number(left.rows[0].total)).toBe(0);
    expect(Number(columns.rows[0].total)).toBe(0);
    expect(fee.rows[0].priority).toBe("OPTIONAL");

    const up = await runner({ databaseUrl: testDbConfig(), dir: migrationsDir, direction: "up", migrationsTable: "pgmigrations", log: () => {} });
    expect(up.map((m) => m.name)).toEqual(later);
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
