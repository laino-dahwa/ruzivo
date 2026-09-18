import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runner } from "node-pg-migrate";
import path from "node:path";
import { Pool } from "pg";

/**
 * Runs against its own throwaway database rather than the shared dev one.
 *
 * Bootstrap is defined by a global condition — "does any administrator exist
 * yet" — so testing it against the developer's real database would both
 * depend on that database's state and pollute it (the app would afterwards
 * believe it had been set up by a test). Vitest isolates each test file in
 * its own process and lib/db builds its pool lazily on first use, so
 * redirecting PGDATABASE here affects nothing else.
 */
const TEST_DATABASE = "ruzivo_auth_test";
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

const SCHOOL = "AUT";

// Imported lazily, after PGDATABASE is redirected, so nothing touches the
// developer's database at module load.
type Mod = Record<string, never>;
let POST_BOOTSTRAP: (r: Request) => Promise<Response>;
let GET_BOOTSTRAP: () => Promise<Response>;
let POST_LOGIN: (r: Request) => Promise<Response>;
let POST_LOGOUT: (r: Request) => Promise<Response>;
let GET_SESSION: (r: Request) => Promise<Response>;
let PATCH_SESSION: (r: Request) => Promise<Response>;
let POST_PASSWORD: (r: Request) => Promise<Response>;
let query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, never>[]; rowCount: number | null }>;

function request(url: string, init?: RequestInit & { token?: string }) {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  if (init?.token) {
    headers.set("cookie", `ssv_session=${init.token}`);
  }
  return new Request(url, { ...init, headers });
}

function post(url: string, body: unknown, token?: string) {
  return request(url, { method: "POST", body: JSON.stringify(body), token });
}

/** The session token a response just set, or null when it set none. */
function tokenFrom(response: Response): string | null {
  const header = response.headers.get("set-cookie");
  if (!header) return null;
  const match = /ssv_session=([^;]*)/.exec(header);
  const value = match?.[1] ?? "";
  return value === "" ? null : decodeURIComponent(value);
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
  ({ POST: POST_BOOTSTRAP, GET: GET_BOOTSTRAP } = (await import("../app/api/auth/bootstrap/route")) as unknown as Mod & {
    POST: typeof POST_BOOTSTRAP;
    GET: typeof GET_BOOTSTRAP;
  });
  ({ POST: POST_LOGIN } = (await import("../app/api/auth/login/route")) as unknown as Mod & { POST: typeof POST_LOGIN });
  ({ POST: POST_LOGOUT } = (await import("../app/api/auth/logout/route")) as unknown as Mod & { POST: typeof POST_LOGOUT });
  ({ GET: GET_SESSION, PATCH: PATCH_SESSION } = (await import("../app/api/auth/session/route")) as unknown as Mod & {
    GET: typeof GET_SESSION;
    PATCH: typeof PATCH_SESSION;
  });
  ({ POST: POST_PASSWORD } = (await import("../app/api/auth/password/route")) as unknown as Mod & { POST: typeof POST_PASSWORD });

  await query(`INSERT INTO schools (school_id, school_name) VALUES ($1, $2)`, [SCHOOL, "Auth Test School"]);
});

afterAll(async () => {
  // The pool must be closed before the database can be dropped.
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

const ADMIN_PASSWORD = "a-good-long-passphrase";
let adminToken: string;

describe("first-run setup", () => {
  it("offers setup, and lists the schools an administrator can be attached to", async () => {
    const response = await GET_BOOTSTRAP();
    const body = await response.json();
    expect(body.available).toBe(true);
    expect(body.schools).toEqual([{ school_id: SCHOOL, school_name: "Auth Test School" }]);
  });

  it("refuses a password that is too easy to guess", async () => {
    const response = await POST_BOOTSTRAP(
      post("http://localhost/api/auth/bootstrap", { first_name: "Ada", last_name: "Admin", password: "password123", school_id: SCHOOL })
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/too easy to guess/i);
  });

  it("refuses a password shorter than the minimum", async () => {
    const response = await POST_BOOTSTRAP(
      post("http://localhost/api/auth/bootstrap", { first_name: "Ada", last_name: "Admin", password: "short", school_id: SCHOOL })
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/at least/i);
  });

  it("creates the first administrator and signs them straight in", async () => {
    const response = await POST_BOOTSTRAP(
      post("http://localhost/api/auth/bootstrap", { first_name: "Ada", last_name: "Admin", password: ADMIN_PASSWORD, school_id: SCHOOL })
    );
    expect(response.status).toBe(201);

    const created = await response.json();
    expect(created.email).toBe(`aadmin@${SCHOOL.toLowerCase()}.school`);
    expect(created.school_id).toBe(SCHOOL);
    // The password must never come back out, in any form.
    expect(created.password).toBeUndefined();
    expect(created.password_hash).toBeUndefined();

    const token = tokenFrom(response);
    expect(token).toBeTruthy();
    adminToken = token!;

    // The account it made is a real administrator, and is not being asked to
    // change the password it just chose.
    const row = await query(
      `SELECT r.access_level, e.must_change_password FROM employees e JOIN roles r ON r.role_id = e.role_id WHERE e.email = $1`,
      [created.email]
    );
    expect(row.rows[0].access_level).toBe("ADMIN");
    expect(row.rows[0].must_change_password).toBe(false);
  });

  it("refuses to run a second time, and stops advertising itself", async () => {
    const second = await POST_BOOTSTRAP(
      post("http://localhost/api/auth/bootstrap", { first_name: "Eve", last_name: "Intruder", password: "another-long-passphrase", school_id: SCHOOL })
    );
    expect(second.status).toBe(409);

    const availability = await GET_BOOTSTRAP();
    expect((await availability.json()).available).toBe(false);

    const admins = await query(`SELECT count(*) AS total FROM roles WHERE access_level = 'ADMIN'`);
    expect(Number(admins.rows[0].total)).toBe(1);
  });
});

describe("signing in", () => {
  const email = `aadmin@${SCHOOL.toLowerCase()}.school`;

  it("rejects a wrong password", async () => {
    const response = await POST_LOGIN(post("http://localhost/api/auth/login", { email, password: "not-the-password" }));
    expect(response.status).toBe(401);
    expect(tokenFrom(response)).toBeNull();
  });

  it("gives an unknown email exactly the same answer as a wrong password", async () => {
    const unknown = await POST_LOGIN(post("http://localhost/api/auth/login", { email: "nobody@nowhere.school", password: "whatever-at-all" }));
    const wrong = await POST_LOGIN(post("http://localhost/api/auth/login", { email, password: "still-not-it" }));
    expect(unknown.status).toBe(wrong.status);
    // Identical wording, so the response cannot be used to discover which
    // accounts exist.
    expect((await unknown.json()).error).toBe((await wrong.json()).error);
  });

  it("accepts the right password and issues a session", async () => {
    const response = await POST_LOGIN(post("http://localhost/api/auth/login", { email, password: ADMIN_PASSWORD }));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.access_level).toBe("ADMIN");
    expect(body.password_hash).toBeUndefined();

    const token = tokenFrom(response);
    expect(token).toBeTruthy();

    const session = await GET_SESSION(request("http://localhost/api/auth/session", { token: token! }));
    expect((await session.json()).actor.email).toBe(email);
  });

  it("sets the session cookie httpOnly, so scripts on the page cannot read it", async () => {
    const response = await POST_LOGIN(post("http://localhost/api/auth/login", { email, password: ADMIN_PASSWORD }));
    const header = response.headers.get("set-cookie") ?? "";
    expect(header.toLowerCase()).toContain("httponly");
    expect(header.toLowerCase()).toContain("samesite=lax");
  });

  it("stores the session token hashed, never in the clear", async () => {
    const response = await POST_LOGIN(post("http://localhost/api/auth/login", { email, password: ADMIN_PASSWORD }));
    const token = tokenFrom(response)!;
    const stored = await query(`SELECT token_hash FROM sessions WHERE token_hash = $1`, [token]);
    // The raw token must not appear as a stored value anywhere.
    expect(stored.rowCount).toBe(0);
  });

  it("reports no session at all when there is no cookie", async () => {
    const response = await GET_SESSION(request("http://localhost/api/auth/session"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.actor).toBeNull();
    // Setup is done, so the client must not be sent back to the setup screen.
    expect(body.needs_setup).toBe(false);
  });

  it("locks an account after repeated failures, then reports it plainly", async () => {
    await query(`INSERT INTO roles (school_id, role_name) VALUES ($1, 'Locked Role') ON CONFLICT DO NOTHING`, [SCHOOL]);
    const role = await query(`SELECT role_id FROM roles WHERE school_id = $1 AND role_name = 'Locked Role'`, [SCHOOL]);
    await query(
      `INSERT INTO employees (school_id, first_name, last_name, email, password_hash, role_id) VALUES ($1, 'Lock', 'Target', $2, 'scrypt$16384$00$00', $3)`,
      [SCHOOL, `locked@${SCHOOL.toLowerCase()}.school`, role.rows[0].role_id]
    );

    const attempt = () => POST_LOGIN(post("http://localhost/api/auth/login", { email: `locked@${SCHOOL.toLowerCase()}.school`, password: "wrong-password" }));

    for (let i = 0; i < 5; i++) {
      expect((await attempt()).status).toBe(401);
    }

    const locked = await attempt();
    expect(locked.status).toBe(423);
    expect((await locked.json()).error).toMatch(/too many failed attempts/i);
  });
});

describe("signing out", () => {
  it("makes the session stop working immediately", async () => {
    const login = await POST_LOGIN(post("http://localhost/api/auth/login", { email: `aadmin@${SCHOOL.toLowerCase()}.school`, password: ADMIN_PASSWORD }));
    const token = tokenFrom(login)!;

    const before = await GET_SESSION(request("http://localhost/api/auth/session", { token }));
    expect((await before.json()).actor).not.toBeNull();

    await POST_LOGOUT(post("http://localhost/api/auth/logout", {}, token));

    const after = await GET_SESSION(request("http://localhost/api/auth/session", { token }));
    expect((await after.json()).actor).toBeNull();
  });
});

describe("changing your own password", () => {
  it("refuses when the current password is wrong", async () => {
    const login = await POST_LOGIN(post("http://localhost/api/auth/login", { email: `aadmin@${SCHOOL.toLowerCase()}.school`, password: ADMIN_PASSWORD }));
    const token = tokenFrom(login)!;

    const response = await POST_PASSWORD(
      post("http://localhost/api/auth/password", { current_password: "wrong", new_password: "a-brand-new-passphrase" }, token)
    );
    expect(response.status).toBe(400);
  });

  it("changes the password and kills every session signed in with the old one", async () => {
    const first = await POST_LOGIN(post("http://localhost/api/auth/login", { email: `aadmin@${SCHOOL.toLowerCase()}.school`, password: ADMIN_PASSWORD }));
    const oldToken = tokenFrom(first)!;
    const second = await POST_LOGIN(post("http://localhost/api/auth/login", { email: `aadmin@${SCHOOL.toLowerCase()}.school`, password: ADMIN_PASSWORD }));
    const changingToken = tokenFrom(second)!;

    const changed = await POST_PASSWORD(
      post("http://localhost/api/auth/password", { current_password: ADMIN_PASSWORD, new_password: "a-brand-new-passphrase" }, changingToken)
    );
    expect(changed.status).toBe(200);

    // The other device's session is gone.
    const stale = await GET_SESSION(request("http://localhost/api/auth/session", { token: oldToken }));
    expect((await stale.json()).actor).toBeNull();

    // The one that did the changing was handed a fresh cookie and keeps working.
    const replacement = tokenFrom(changed)!;
    const current = await GET_SESSION(request("http://localhost/api/auth/session", { token: replacement }));
    expect((await current.json()).actor).not.toBeNull();

    // And the old password no longer signs anyone in.
    const oldPassword = await POST_LOGIN(post("http://localhost/api/auth/login", { email: `aadmin@${SCHOOL.toLowerCase()}.school`, password: ADMIN_PASSWORD }));
    expect(oldPassword.status).toBe(401);

    // Put it back, so later tests can keep using the original password.
    await POST_PASSWORD(post("http://localhost/api/auth/password", { current_password: "a-brand-new-passphrase", new_password: ADMIN_PASSWORD }, replacement));
  });
});

describe("switching schools", () => {
  it("lets an administrator switch, and refuses a cashier", async () => {
    await query(`INSERT INTO schools (school_id, school_name) VALUES ($1, $2)`, ["AU2", "Second Auth School"]);

    const login = await POST_LOGIN(post("http://localhost/api/auth/login", { email: `aadmin@${SCHOOL.toLowerCase()}.school`, password: ADMIN_PASSWORD }));
    adminToken = tokenFrom(login)!;

    const switched = await PATCH_SESSION(
      request("http://localhost/api/auth/session", { method: "PATCH", body: JSON.stringify({ school_id: "AU2" }), token: adminToken })
    );
    expect(switched.status).toBe(200);
    expect((await switched.json()).active_school_id).toBe("AU2");

    // A cashier, created the normal way, must not be able to do the same.
    const role = await query(`INSERT INTO roles (school_id, role_name) VALUES ($1, 'Cashier') RETURNING role_id`, [SCHOOL]);
    const { createEmployees } = await import("../repositories/employee/create/createEmployee");
    const [cashier] = await createEmployees([
      { school_id: SCHOOL, first_name: "Cass", last_name: "Hier", role_id: Number(role.rows[0].role_id) },
    ]);

    const cashierLogin = await POST_LOGIN(post("http://localhost/api/auth/login", { email: cashier.email, password: cashier.temporary_password }));
    expect(cashierLogin.status).toBe(200);
    const cashierToken = tokenFrom(cashierLogin)!;

    const refused = await PATCH_SESSION(
      request("http://localhost/api/auth/session", { method: "PATCH", body: JSON.stringify({ school_id: "AU2" }), token: cashierToken })
    );
    expect(refused.status).toBe(403);
  });
});
