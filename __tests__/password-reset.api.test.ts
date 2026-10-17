import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runner } from "node-pg-migrate";
import path from "node:path";
import { Pool } from "pg";

/** Own throwaway database — this route needs a signed-in administrator. */
const TEST_DATABASE = "ruzivo_password_reset_test";
const migrationsDir = path.join(__dirname, "..", "migrations");
const SCHOOL = "PWR";
const OTHER_SCHOOL = "PWO";
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
let GET_SESSION: (r: Request) => Promise<Response>;
let POST_RESET: Handler;
let query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, never>[]; rowCount: number | null }>;

let adminToken = "";
let adminId = 0;
let cashier = { employee_id: 0, email: "", temporary_password: "" };
let otherSchoolEmployeeId = 0;

function request(url: string, init?: RequestInit & { token?: string }) {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  if (init?.token) headers.set("cookie", `ssv_session=${init.token}`);
  return new Request(url, { ...init, headers });
}

function post(url: string, body: unknown, token?: string) {
  return request(url, { method: "POST", body: JSON.stringify(body), token });
}

function tokenFrom(response: Response): string {
  const match = /ssv_session=([^;]*)/.exec(response.headers.get("set-cookie") ?? "");
  return decodeURIComponent(match?.[1] ?? "");
}

function reset(employeeId: number, token?: string, school = SCHOOL) {
  return POST_RESET(
    request(`http://localhost/api/schools/${school}/employees/${employeeId}/password`, { method: "POST", token }),
    { params: Promise.resolve({ school_id: school, employee_id: String(employeeId) }) }
  );
}

function login(email: string, password: string) {
  return POST_LOGIN(post("http://localhost/api/auth/login", { email, password }));
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
  ({ GET: GET_SESSION } = (await import("../app/api/auth/session/route")) as unknown as { GET: typeof GET_SESSION });
  ({ POST: POST_RESET } = (await import("../app/api/schools/[school_id]/employees/[employee_id]/password/route")) as unknown as {
    POST: Handler;
  });

  await query(`INSERT INTO schools (school_id, school_name) VALUES ($1, 'Reset Test School'), ($2, 'Other School')`, [SCHOOL, OTHER_SCHOOL]);

  const bootstrap = await POST_BOOTSTRAP(
    post("http://localhost/api/auth/bootstrap", { first_name: "Ada", last_name: "Admin", password: ADMIN_PASSWORD, school_id: SCHOOL })
  );
  adminToken = tokenFrom(bootstrap);
  adminId = Number((await query(`SELECT employee_id FROM employees WHERE school_id = $1`, [SCHOOL])).rows[0].employee_id);

  const role = await query(`INSERT INTO roles (school_id, role_name) VALUES ($1, 'Cashier') RETURNING role_id`, [SCHOOL]);
  const otherRole = await query(`INSERT INTO roles (school_id, role_name) VALUES ($1, 'Cashier') RETURNING role_id`, [OTHER_SCHOOL]);
  const { createEmployees } = await import("../repositories/employee/create/createEmployee");
  // BIGINT ids come back from pg as strings.
  const [created] = await createEmployees([{ school_id: SCHOOL, first_name: "Cass", last_name: "Hier", role_id: Number(role.rows[0].role_id) }]);
  cashier = { ...created, employee_id: Number(created.employee_id) };
  const [other] = await createEmployees([{ school_id: OTHER_SCHOOL, first_name: "Otto", last_name: "Ther", role_id: Number(otherRole.rows[0].role_id) }]);
  otherSchoolEmployeeId = Number(other.employee_id);
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

describe("who may reset a password", () => {
  it("refuses a request with no session", async () => {
    expect((await reset(cashier.employee_id)).status).toBe(401);
  });

  it("refuses a cashier", async () => {
    const cashierToken = tokenFrom(await login(cashier.email, cashier.temporary_password));
    expect((await reset(adminId, cashierToken)).status).toBe(403);
  });

  it("refuses an administrator resetting their own password — that goes through Change password", async () => {
    expect((await reset(adminId, adminToken)).status).toBe(400);
  });
});

describe("an administrator resetting someone's password", () => {
  it("issues a one-time password that works, retires the old one, and requires a change at next sign-in", async () => {
    const before = tokenFrom(await login(cashier.email, cashier.temporary_password));

    const response = await reset(cashier.employee_id, adminToken);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ employee_id: cashier.employee_id, email: cashier.email });
    expect(body.temporary_password).toEqual(expect.any(String));
    expect(body.temporary_password).not.toBe(cashier.temporary_password);

    // Signed out everywhere: the session from before the reset is gone.
    const stale = await GET_SESSION(request("http://localhost/api/auth/session", { token: before }));
    expect((await stale.json()).actor).toBeNull();

    // The old password no longer works; the new one does, and must be changed.
    expect((await login(cashier.email, cashier.temporary_password)).status).toBe(401);
    const fresh = await login(cashier.email, body.temporary_password);
    expect(fresh.status).toBe(200);
    const session = await GET_SESSION(request("http://localhost/api/auth/session", { token: tokenFrom(fresh) }));
    expect((await session.json()).actor.must_change_password).toBe(true);

    // Stored hashed, never in the clear.
    const stored = await query(`SELECT password_hash FROM employees WHERE employee_id = $1`, [cashier.employee_id]);
    expect(stored.rows[0].password_hash).not.toContain(body.temporary_password);

    cashier = { ...cashier, temporary_password: body.temporary_password };
  });

  it("clears a lockout, so a locked-out employee can sign in straight away", async () => {
    await query(`UPDATE employees SET failed_login_count = 5, locked_until = now() + interval '15 minutes' WHERE employee_id = $1`, [cashier.employee_id]);

    const body = await (await reset(cashier.employee_id, adminToken)).json();
    expect((await login(cashier.email, body.temporary_password)).status).toBe(200);
    cashier = { ...cashier, temporary_password: body.temporary_password };
  });

  it("records who reset whose password in the audit log, without the password", async () => {
    const entries = await query(
      `SELECT employee_id, summary, detail FROM audit_log WHERE action = 'user.password_reset' AND entity_id = $1`,
      [String(cashier.employee_id)]
    );
    expect(entries.rows.length).toBeGreaterThan(0);
    expect(Number(entries.rows[0].employee_id)).toBe(adminId);
    expect(entries.rows[0].summary).toContain(cashier.email);
    expect(JSON.stringify(entries.rows)).not.toContain(cashier.temporary_password);
  });

  it("does not reach an employee of another school through this school's URL", async () => {
    expect((await reset(otherSchoolEmployeeId, adminToken)).status).toBe(404);
  });

  it("answers 404 for an employee that does not exist, and 400 for a malformed id", async () => {
    expect((await reset(999999, adminToken)).status).toBe(404);
    const malformed = await POST_RESET(
      request(`http://localhost/api/schools/${SCHOOL}/employees/abc/password`, { method: "POST", token: adminToken }),
      { params: Promise.resolve({ school_id: SCHOOL, employee_id: "abc" }) }
    );
    expect(malformed.status).toBe(400);
  });
});
