import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runner } from "node-pg-migrate";
import path from "node:path";
import { Pool } from "pg";
import { computePay, periodLabel } from "../lib/payroll/compute";

/** Own throwaway database — these routes need a signed-in administrator. */
const TEST_DATABASE = "ruzivo_payroll_test";
const migrationsDir = path.join(__dirname, "..", "migrations");
const SCHOOL = "PAY";
const ADMIN_PASSWORD = "a-good-long-passphrase";

function adminConfig() {
  return {
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGADMINDB || "postgres",
  };
}

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

let POST_BOOTSTRAP: (r: Request) => Promise<Response>;
let POST_LOGIN: (r: Request) => Promise<Response>;
let GET_PAYROLL: Handler;
let PATCH_PAYROLL: Handler;
let GET_RUNS: Handler;
let POST_RUNS: Handler;
let GET_RUN: Handler;
let query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, never>[]; rowCount: number | null }>;

let adminToken = "";
let cashierToken = "";
let teacherId = 0;
let unpaidId = 0;

const PAYROLL_URL = `http://localhost/api/schools/${SCHOOL}/payroll`;

function request(url: string, init?: RequestInit & { token?: string }) {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  if (init?.token) headers.set("cookie", `ssv_session=${init.token}`);
  return new Request(url, { ...init, headers });
}

function post(url: string, body: unknown, token?: string) {
  return request(url, { method: "POST", body: JSON.stringify(body), token });
}

function patch(url: string, body: unknown, token?: string) {
  return request(url, { method: "PATCH", body: JSON.stringify(body), token });
}

function params(values: Record<string, string>) {
  return { params: Promise.resolve(values) };
}

function tokenFrom(response: Response): string {
  const match = /ssv_session=([^;]*)/.exec(response.headers.get("set-cookie") ?? "");
  return decodeURIComponent(match?.[1] ?? "");
}

beforeAll(async () => {
  const admin = new Pool(adminConfig());
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DATABASE}`);
    await admin.query(`CREATE DATABASE ${TEST_DATABASE}`);
  } finally {
    await admin.end();
  }

  process.env.PGDATABASE = TEST_DATABASE;

  await runner({
    databaseUrl: { ...adminConfig(), database: TEST_DATABASE },
    dir: migrationsDir,
    direction: "up",
    migrationsTable: "pgmigrations",
    log: () => {},
  });

  ({ query } = (await import("../lib/db")) as unknown as { query: typeof query });
  ({ POST: POST_BOOTSTRAP } = (await import("../app/api/auth/bootstrap/route")) as unknown as { POST: typeof POST_BOOTSTRAP });
  ({ POST: POST_LOGIN } = (await import("../app/api/auth/login/route")) as unknown as { POST: typeof POST_LOGIN });
  ({ GET: GET_PAYROLL, PATCH: PATCH_PAYROLL } = (await import("../app/api/schools/[school_id]/payroll/route")) as unknown as {
    GET: Handler;
    PATCH: Handler;
  });
  ({ GET: GET_RUNS, POST: POST_RUNS } = (await import("../app/api/schools/[school_id]/payroll/runs/route")) as unknown as {
    GET: Handler;
    POST: Handler;
  });
  ({ GET: GET_RUN } = (await import("../app/api/schools/[school_id]/payroll/runs/[run_id]/route")) as unknown as { GET: Handler });

  await query(`INSERT INTO schools (school_id, school_name) VALUES ($1, $2)`, [SCHOOL, "Payroll Test School"]);

  adminToken = tokenFrom(
    await POST_BOOTSTRAP(post("http://localhost/api/auth/bootstrap", { first_name: "Ada", last_name: "Admin", password: ADMIN_PASSWORD, school_id: SCHOOL }))
  );

  const role = await query(`INSERT INTO roles (school_id, role_name) VALUES ($1, 'Teacher') RETURNING role_id`, [SCHOOL]);
  const cashierRole = await query(`INSERT INTO roles (school_id, role_name) VALUES ($1, 'Cashier') RETURNING role_id`, [SCHOOL]);
  const { createEmployees } = await import("../repositories/employee/create/createEmployee");

  const [teacher, unpaid] = await createEmployees([
    { school_id: SCHOOL, first_name: "Tariro", last_name: "Banda", role_id: Number(role.rows[0].role_id) },
    { school_id: SCHOOL, first_name: "Never", last_name: "Set", role_id: Number(role.rows[0].role_id) },
  ]);
  teacherId = teacher.employee_id;
  unpaidId = unpaid.employee_id;

  const [cashier] = await createEmployees([
    { school_id: SCHOOL, first_name: "Cass", last_name: "Hier", role_id: Number(cashierRole.rows[0].role_id) },
  ]);
  cashierToken = tokenFrom(await POST_LOGIN(post("http://localhost/api/auth/login", { email: cashier.email, password: cashier.temporary_password })));
});

afterAll(async () => {
  const { getPool } = await import("../lib/db");
  const pool = await getPool();
  await pool.end();

  const admin = new Pool(adminConfig());
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DATABASE}`);
  } finally {
    await admin.end();
  }
});

describe("computing pay", () => {
  it("adds allowances into gross and takes deductions off it", () => {
    const pay = computePay({
      basic_salary: 850,
      transport_allowance: 50,
      housing_allowance: 0,
      paye_deduction: 90,
      pension_deduction: 45,
    });
    expect(pay.grossPay).toBe(900);
    expect(pay.totalDeductions).toBe(135);
    expect(pay.netPay).toBe(765);
  });

  it("shows a negative net rather than hiding a data-entry mistake", () => {
    // Deductions above gross means somebody typed something wrong. Clamping
    // it to zero would leave the payslip quietly incorrect instead.
    const pay = computePay({ basic_salary: 100, transport_allowance: 0, housing_allowance: 0, paye_deduction: 500, pension_deduction: 0 });
    expect(pay.netPay).toBe(-400);
  });

  it("names the period the way a payslip reads", () => {
    expect(periodLabel(2026, 9)).toBe("September 2026");
  });
});

describe("who may see payroll", () => {
  it("refuses a request with no session", async () => {
    expect((await GET_PAYROLL(request(PAYROLL_URL), params({ school_id: SCHOOL }))).status).toBe(401);
  });

  it("refuses a cashier — salaries are not till-desk information", async () => {
    expect((await GET_PAYROLL(request(PAYROLL_URL, { token: cashierToken }), params({ school_id: SCHOOL }))).status).toBe(403);
    expect((await POST_RUNS(post(`${PAYROLL_URL}/runs`, { period_year: 2026, period_month: 9 }, cashierToken), params({ school_id: SCHOOL }))).status).toBe(403);
  });
});

describe("recording what people are paid", () => {
  it("lists staff with no pay recorded yet", async () => {
    const response = await GET_PAYROLL(request(PAYROLL_URL, { token: adminToken }), params({ school_id: SCHOOL }));
    expect(response.status).toBe(200);

    const rows = await response.json();
    // Ada (the bootstrap admin), Tariro, Never and Cass.
    expect(rows).toHaveLength(4);
    expect(rows.every((row: { basic_salary: string | null }) => row.basic_salary === null)).toBe(true);
  });

  it("saves a salary with its allowances and deductions", async () => {
    const response = await PATCH_PAYROLL(
      patch(PAYROLL_URL, { employee_id: teacherId, basic_salary: 850, transport_allowance: 50, housing_allowance: 0, paye_deduction: 90, pension_deduction: 45 }, adminToken),
      params({ school_id: SCHOOL })
    );
    expect(response.status).toBe(200);

    const row = await query(`SELECT basic_salary, transport_allowance, paye_deduction FROM employees WHERE employee_id = $1`, [teacherId]);
    expect(Number(row.rows[0].basic_salary)).toBe(850);
    expect(Number(row.rows[0].transport_allowance)).toBe(50);
    expect(Number(row.rows[0].paye_deduction)).toBe(90);
  });

  it("rejects a negative amount rather than quietly turning it into zero", async () => {
    const response = await PATCH_PAYROLL(patch(PAYROLL_URL, { employee_id: teacherId, basic_salary: -500 }, adminToken), params({ school_id: SCHOOL }));
    expect(response.status).toBe(400);
  });

  it("refuses to edit an employee at another school", async () => {
    await query(`INSERT INTO schools (school_id, school_name) VALUES ('PA2', 'Other')`);
    const response = await PATCH_PAYROLL(
      patch(`http://localhost/api/schools/PA2/payroll`, { employee_id: teacherId, basic_salary: 1 }, adminToken),
      params({ school_id: "PA2" })
    );
    // The administrator may act on PA2, but this employee does not belong to it.
    expect(response.status).toBe(404);
  });

  it("records the change in the audit log", async () => {
    const audit = await query(`SELECT action, actor_label FROM audit_log WHERE action = 'payroll.pay_change' AND entity_id = $1`, [String(teacherId)]);
    expect((audit.rowCount ?? 0)).toBeGreaterThan(0);
    expect(audit.rows[0].actor_label).toBe("Ada Admin");
  });
});

describe("running payroll", () => {
  it("includes only staff who have a salary recorded", async () => {
    const response = await POST_RUNS(post(`${PAYROLL_URL}/runs`, { period_year: 2026, period_month: 9 }, adminToken), params({ school_id: SCHOOL }));
    expect(response.status).toBe(201);

    const run = await response.json();
    // Only Tariro has a salary; the other three are left out rather than
    // issued a payslip for nothing.
    expect(run.employee_count).toBe(1);

    const lines = await query(`SELECT employee_label, basic_salary FROM payroll_lines WHERE payroll_run_id = $1`, [run.payroll_run_id]);
    expect(lines.rows).toHaveLength(1);
    expect(lines.rows[0].employee_label).toBe("Tariro Banda");

    const excluded = await query(`SELECT count(*) AS total FROM payroll_lines l WHERE l.employee_id = $1`, [unpaidId]);
    expect(Number(excluded.rows[0].total)).toBe(0);
  });

  it("freezes the figures, so a later pay rise does not rewrite the past", async () => {
    const before = await query(
      `SELECT l.basic_salary FROM payroll_lines l JOIN payroll_runs r ON r.payroll_run_id = l.payroll_run_id
       WHERE r.period_year = 2026 AND r.period_month = 9 AND l.employee_id = $1`,
      [teacherId]
    );
    expect(Number(before.rows[0].basic_salary)).toBe(850);

    await PATCH_PAYROLL(
      patch(PAYROLL_URL, { employee_id: teacherId, basic_salary: 1200, transport_allowance: 50, housing_allowance: 0, paye_deduction: 90, pension_deduction: 45 }, adminToken),
      params({ school_id: SCHOOL })
    );

    const after = await query(
      `SELECT l.basic_salary FROM payroll_lines l JOIN payroll_runs r ON r.payroll_run_id = l.payroll_run_id
       WHERE r.period_year = 2026 AND r.period_month = 9 AND l.employee_id = $1`,
      [teacherId]
    );
    // September still says 850 even though the salary is now 1200.
    expect(Number(after.rows[0].basic_salary)).toBe(850);
  });

  it("re-running a month replaces it rather than stacking up duplicates", async () => {
    const rerun = await POST_RUNS(post(`${PAYROLL_URL}/runs`, { period_year: 2026, period_month: 9 }, adminToken), params({ school_id: SCHOOL }));
    expect(rerun.status).toBe(201);
    expect((await rerun.json()).was_rerun).toBe(true);

    const runs = await query(`SELECT count(*) AS total FROM payroll_runs WHERE period_year = 2026 AND period_month = 9`);
    expect(Number(runs.rows[0].total)).toBe(1);

    // Re-running picks up the new salary.
    const line = await query(
      `SELECT l.basic_salary FROM payroll_lines l JOIN payroll_runs r ON r.payroll_run_id = l.payroll_run_id
       WHERE r.period_year = 2026 AND r.period_month = 9`
    );
    expect(Number(line.rows[0].basic_salary)).toBe(1200);

    const audit = await query(`SELECT count(*) AS total FROM audit_log WHERE action = 'payroll.rerun'`);
    expect(Number(audit.rows[0].total)).toBeGreaterThan(0);
  });

  it("posts the wage bill to expenses, under a Salaries category it creates itself", async () => {
    const runs = await GET_RUNS(request(`${PAYROLL_URL}/runs`, { token: adminToken }), params({ school_id: SCHOOL }));
    const [run] = await runs.json();

    const expense = await query(
      `
      SELECT e.amount, e.expense_date, e.description, c.expense_name, e.recorded_by_employee_id
      FROM payroll_runs p
      JOIN expenses e ON e.expense_id = p.expense_id
      JOIN expense_categories c ON c.expense_category_id = e.expense_category_id
      WHERE p.payroll_run_id = $1
      `,
      [run.payroll_run_id]
    );

    expect(expense.rowCount).toBe(1);
    expect(expense.rows[0].expense_name).toBe("Salaries");
    // Gross (1200 + 50 transport), not the 1065 take-home: the school's cost
    // includes the PAYE and pension it withholds and passes on.
    expect(Number(expense.rows[0].amount)).toBe(1250);
    // Booked against the month it is for, not the day it was generated.
    // Compared part by part rather than as a string: node-pg hands a DATE
    // back as a Date at local midnight, so formatting it via ISO would slide
    // it a day either way depending on the machine's timezone.
    const bookedOn = new Date(expense.rows[0].expense_date);
    expect([bookedOn.getFullYear(), bookedOn.getMonth() + 1, bookedOn.getDate()]).toEqual([2026, 9, 30]);
    expect(expense.rows[0].description).toContain("September 2026");
  });

  it("updates the same expense on a re-run instead of double-counting the wage bill", async () => {
    const before = await query(`SELECT count(*) AS total FROM expenses e JOIN expense_categories c ON c.expense_category_id = e.expense_category_id WHERE c.expense_name = 'Salaries'`);

    await PATCH_PAYROLL(
      patch(PAYROLL_URL, { employee_id: teacherId, basic_salary: 2000, transport_allowance: 0, housing_allowance: 0, paye_deduction: 0, pension_deduction: 0 }, adminToken),
      params({ school_id: SCHOOL })
    );
    await POST_RUNS(post(`${PAYROLL_URL}/runs`, { period_year: 2026, period_month: 9 }, adminToken), params({ school_id: SCHOOL }));

    const after = await query(`SELECT count(*) AS total FROM expenses e JOIN expense_categories c ON c.expense_category_id = e.expense_category_id WHERE c.expense_name = 'Salaries'`);
    // Still one expense for September, not two.
    expect(Number(after.rows[0].total)).toBe(Number(before.rows[0].total));

    const amount = await query(
      `SELECT e.amount FROM payroll_runs p JOIN expenses e ON e.expense_id = p.expense_id WHERE p.period_year = 2026 AND p.period_month = 9`
    );
    expect(Number(amount.rows[0].amount)).toBe(2000);
  });

  it("posts a separate expense for a different month", async () => {
    await POST_RUNS(post(`${PAYROLL_URL}/runs`, { period_year: 2026, period_month: 10 }, adminToken), params({ school_id: SCHOOL }));

    const expenses = await query(
      `
      SELECT p.period_month, e.expense_date
      FROM payroll_runs p JOIN expenses e ON e.expense_id = p.expense_id
      WHERE p.school_id = $1 ORDER BY p.period_month
      `,
      [SCHOOL]
    );
    expect(expenses.rows).toHaveLength(2);
    // October ends on the 31st — the last day is worked out per month, not
    // assumed to be the 30th.
    const october = new Date(expenses.rows[1].expense_date);
    expect([october.getFullYear(), october.getMonth() + 1, october.getDate()]).toEqual([2026, 10, 31]);
  });

  it("refuses a month or year that is not a real period", async () => {
    expect((await POST_RUNS(post(`${PAYROLL_URL}/runs`, { period_year: 2026, period_month: 13 }, adminToken), params({ school_id: SCHOOL }))).status).toBe(400);
    expect((await POST_RUNS(post(`${PAYROLL_URL}/runs`, { period_year: 1200, period_month: 4 }, adminToken), params({ school_id: SCHOOL }))).status).toBe(400);
  });

  it("says so plainly when nobody has a salary yet", async () => {
    await query(`INSERT INTO schools (school_id, school_name) VALUES ('PA3', 'Empty Payroll')`);
    const response = await POST_RUNS(post(`http://localhost/api/schools/PA3/payroll/runs`, { period_year: 2026, period_month: 9 }, adminToken), params({ school_id: "PA3" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/nothing to generate/i);
  });
});

describe("the payslip PDF", () => {
  it("renders every payslip for the month", async () => {
    const runs = await GET_RUNS(request(`${PAYROLL_URL}/runs`, { token: adminToken }), params({ school_id: SCHOOL }));
    const [run] = await runs.json();

    const response = await GET_RUN(
      request(`${PAYROLL_URL}/runs/${run.payroll_run_id}`, { token: adminToken }),
      params({ school_id: SCHOOL, run_id: String(run.payroll_run_id) })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it("produces the same bytes when reprinted", async () => {
    const runs = await GET_RUNS(request(`${PAYROLL_URL}/runs`, { token: adminToken }), params({ school_id: SCHOOL }));
    const [run] = await runs.json();

    const fetchPdf = async () =>
      Buffer.from(
        new Uint8Array(
          await (
            await GET_RUN(
              request(`${PAYROLL_URL}/runs/${run.payroll_run_id}`, { token: adminToken }),
              params({ school_id: SCHOOL, run_id: String(run.payroll_run_id) })
            )
          ).arrayBuffer()
        )
      );

    expect((await fetchPdf()).equals(await fetchPdf())).toBe(true);
  });

  it("refuses a run id belonging to another school", async () => {
    const runs = await GET_RUNS(request(`${PAYROLL_URL}/runs`, { token: adminToken }), params({ school_id: SCHOOL }));
    const [run] = await runs.json();

    const response = await GET_RUN(
      request(`http://localhost/api/schools/PA2/payroll/runs/${run.payroll_run_id}`, { token: adminToken }),
      params({ school_id: "PA2", run_id: String(run.payroll_run_id) })
    );
    expect(response.status).toBe(404);
  });
});
