import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runner } from "node-pg-migrate";
import path from "node:path";
import { Pool } from "pg";

/** Own throwaway database — this exercises first-run setup and sign-in. */
const TEST_DATABASE = "ruzivo_security_key_test";
const migrationsDir = path.join(__dirname, "..", "migrations");
const SCHOOL = "SKY";
const ADMIN_PASSWORD = "a-good-long-passphrase";
const ADMIN_EMAIL = `aadmin@${SCHOOL.toLowerCase()}.school`;

function adminConfig() {
  return {
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGADMINDB || "postgres",
  };
}

type Route = (r: Request) => Promise<Response>;

let POST_BOOTSTRAP: Route;
let POST_LOGIN: Route;
let GET_SESSION: Route;
let POST_RECOVER: Route;
let GET_KEY: Route;
let POST_KEY: Route;
let query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, never>[]; rowCount: number | null }>;

let adminKey = "";
let adminPassword = ADMIN_PASSWORD;
let cashier = { employee_id: 0, email: "", temporary_password: "" };

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

const login = (email: string, password: string) => POST_LOGIN(post("http://localhost/api/auth/login", { email, password }));
const recover = (email: string, security_key: string, new_password: string) =>
  POST_RECOVER(post("http://localhost/api/auth/recover", { email, security_key, new_password }));
const sessionActor = async (token: string) => (await (await GET_SESSION(request("http://localhost/api/auth/session", { token }))).json()).actor;

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
  ({ POST: POST_BOOTSTRAP } = (await import("../app/api/auth/bootstrap/route")) as unknown as { POST: Route });
  ({ POST: POST_LOGIN } = (await import("../app/api/auth/login/route")) as unknown as { POST: Route });
  ({ GET: GET_SESSION } = (await import("../app/api/auth/session/route")) as unknown as { GET: Route });
  ({ POST: POST_RECOVER } = (await import("../app/api/auth/recover/route")) as unknown as { POST: Route });
  ({ GET: GET_KEY, POST: POST_KEY } = (await import("../app/api/auth/security-key/route")) as unknown as { GET: Route; POST: Route });

  await query(`INSERT INTO schools (school_id, school_name) VALUES ($1, 'Security Key School')`, [SCHOOL]);

  const role = await query(`INSERT INTO roles (school_id, role_name) VALUES ($1, 'Cashier') RETURNING role_id`, [SCHOOL]);
  const { createEmployees } = await import("../repositories/employee/create/createEmployee");
  const [created] = await createEmployees([{ school_id: SCHOOL, first_name: "Cass", last_name: "Hier", role_id: Number(role.rows[0].role_id) }]);
  cashier = { ...created, employee_id: Number(created.employee_id) };
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

describe("first-run setup", () => {
  it("gives the first administrator a security key, stored only as a hash", async () => {
    const response = await POST_BOOTSTRAP(
      post("http://localhost/api/auth/bootstrap", { first_name: "Ada", last_name: "Admin", password: ADMIN_PASSWORD, school_id: SCHOOL })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.security_key).toMatch(/^([A-Z2-9]{4}-){5}[A-Z2-9]{4}$/);
    adminKey = body.security_key;

    const stored = await query(`SELECT security_key_hash FROM employees WHERE email = $1`, [ADMIN_EMAIL]);
    expect(stored.rows[0].security_key_hash).toMatch(/^scrypt\$/);
    expect(stored.rows[0].security_key_hash).not.toContain(adminKey.replace(/-/g, ""));
  });
});

describe("recovering a forgotten password with the security key", () => {
  it("refuses a wrong key, an unknown email and an account with no key — all with the same answer", async () => {
    const wrong = await recover(ADMIN_EMAIL, "AAAA-AAAA-AAAA-AAAA-AAAA-AAAA", "a-brand-new-passphrase");
    const unknown = await recover("nobody@sky.school", adminKey, "a-brand-new-passphrase");
    const noKey = await recover(cashier.email, adminKey, "a-brand-new-passphrase");
    for (const response of [wrong, unknown, noKey]) {
      expect(response.status).toBe(401);
      expect((await response.json()).error).toBe("Email or security key is incorrect.");
    }
    // Failures count towards the lockout, and are audited.
    const audit = await query(`SELECT count(*)::int AS total FROM audit_log WHERE action = 'auth.recovery_failed'`);
    expect(audit.rows[0].total).toBe(2);
    await query(`UPDATE employees SET failed_login_count = 0, locked_until = NULL`);
  });

  it("does not use up the key when the new password is refused", async () => {
    const weak = await recover(ADMIN_EMAIL, adminKey, "short");
    expect(weak.status).toBe(400);
    expect((await login(ADMIN_EMAIL, ADMIN_PASSWORD)).status).toBe(200);
  });

  it("sets the new password, signs in, signs out everywhere else, and replaces the key", async () => {
    const elsewhere = tokenFrom(await login(ADMIN_EMAIL, adminPassword));

    // Typed by hand: lower case, spaces instead of dashes.
    const typed = adminKey.toLowerCase().replace(/-/g, " ");
    const response = await recover(ADMIN_EMAIL, typed, "a-brand-new-passphrase");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.must_change_password).toBe(false);
    expect(body.security_key).toMatch(/^([A-Z2-9]{4}-){5}[A-Z2-9]{4}$/);
    expect(body.security_key).not.toBe(adminKey);

    // Signed in by the recovery itself; the other device is signed out.
    expect(await sessionActor(tokenFrom(response))).not.toBeNull();
    expect(await sessionActor(elsewhere)).toBeNull();

    // New password works, old one doesn't.
    expect((await login(ADMIN_EMAIL, adminPassword)).status).toBe(401);
    adminPassword = "a-brand-new-passphrase";
    expect((await login(ADMIN_EMAIL, adminPassword)).status).toBe(200);

    // The old key is used up; the new one works.
    expect((await recover(ADMIN_EMAIL, adminKey, "another-long-passphrase")).status).toBe(401);
    await query(`UPDATE employees SET failed_login_count = 0, locked_until = NULL`);
    adminKey = body.security_key;

    const audit = await query(`SELECT summary FROM audit_log WHERE action = 'auth.recovered'`);
    expect(audit.rows[0].summary).toContain(ADMIN_EMAIL);
  });

  it("locks the account after repeated wrong keys, even against the right key", async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      await recover(ADMIN_EMAIL, "BBBB-BBBB-BBBB-BBBB-BBBB-BBBB", "another-long-passphrase");
    }
    expect((await recover(ADMIN_EMAIL, adminKey, "another-long-passphrase")).status).toBe(423);
    await query(`UPDATE employees SET failed_login_count = 0, locked_until = NULL`);
  });
});

describe("making your own security key", () => {
  it("needs a session and your current password", async () => {
    expect((await POST_KEY(post("http://localhost/api/auth/security-key", { current_password: adminPassword }))).status).toBe(401);
    const token = tokenFrom(await login(ADMIN_EMAIL, adminPassword));
    expect((await POST_KEY(post("http://localhost/api/auth/security-key", { current_password: "wrong" }, token))).status).toBe(400);
  });

  it("replaces the old key with a new one, shown once", async () => {
    const token = tokenFrom(await login(ADMIN_EMAIL, adminPassword));
    const response = await POST_KEY(post("http://localhost/api/auth/security-key", { current_password: adminPassword }, token));
    expect(response.status).toBe(200);
    const { security_key } = await response.json();
    expect(security_key).not.toBe(adminKey);

    const status = await (await GET_KEY(request("http://localhost/api/auth/security-key", { token }))).json();
    expect(status.has_key).toBe(true);
    expect(JSON.stringify(status)).not.toContain(security_key);

    expect((await recover(ADMIN_EMAIL, adminKey, "another-long-passphrase")).status).toBe(401);
    await query(`UPDATE employees SET failed_login_count = 0, locked_until = NULL`);
    adminKey = security_key;
  });

  it("is refused while a temporary password is still in force", async () => {
    const token = tokenFrom(await login(cashier.email, cashier.temporary_password));
    const response = await POST_KEY(post("http://localhost/api/auth/security-key", { current_password: cashier.temporary_password }, token));
    expect(response.status).toBe(403);
  });
});
