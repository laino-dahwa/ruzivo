import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { readFile, readdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Client, Pool } from "pg";
import { runner } from "node-pg-migrate";
import {
  normalizeRow,
  toCents,
  toUtcTimestamp,
  trimChar,
  upsertStatements,
  TABLE_ORDER,
} from "../electron/sync/normalize";
import { collectChanges, readOutbox } from "../electron/sync/collect";
import { runSync, signBody, SyncError, type SyncLink } from "../electron/sync/engine";
import { handleBatch, handleLink, resetColumnCache, type Database, type Statement } from "../cloud/src/sync";
import { renderSite } from "../cloud/src/site";
import { verifyAccess } from "../cloud/src/access";
import { handleLogin, sessionViewer } from "../cloud/src/password";
import { createBackup } from "../electron/backup/create-backup";
import { readBackup } from "../electron/backup/read-backup";
import { restoreBackup, type MigrateFn } from "../electron/backup/restore-backup";
import { OBLIGATIONS_CTE } from "../repositories/payment/read/obligationsQuery";

// ─────────────────────────────────────────────────────────────────────────────
// Row conversion (no database needed)

describe("normalizing rows for D1", () => {
  it("turns NUMERIC money into exact cents", () => {
    expect(toCents("85.00")).toBe(8500);
    expect(toCents(85)).toBe(8500);
    expect(toCents(85.5)).toBe(8550);
    expect(toCents(0.01)).toBe(1);
    expect(toCents("999999.99")).toBe(99999999);
    expect(toCents(9999999999.99)).toBe(999999999999);
    expect(toCents(null)).toBeNull();
    expect(() => toCents("1.234")).toThrow();
  });

  it("turns timestamps with an offset into UTC, keeping microseconds", () => {
    expect(toUtcTimestamp("2026-09-10T09:27:41.58366+02:00")).toBe("2026-09-10T07:27:41.583660Z");
    expect(toUtcTimestamp("2026-10-17T16:31:12+02:00")).toBe("2026-10-17T14:31:12.000000Z");
    expect(toUtcTimestamp(null)).toBeNull();
  });

  it("trims CHAR padding", () => {
    expect(trimChar("SSV ")).toBe("SSV");
    expect(trimChar("BKP1")).toBe("BKP1");
  });

  it("never sends sign-in secrets, and converts booleans and salaries", () => {
    const { row } = normalizeRow("employees", {
      employee_id: 1, school_id: "SSV ", first_name: "A", last_name: "B", email: "a@b", role_id: 2,
      password_hash: "scrypt$secret", security_key_hash: "scrypt$key", must_change_password: false,
      basic_salary: 450.5, transport_allowance: 0, created_at: "2026-10-17T16:31:12.253284+02:00",
    });
    expect(row).not.toHaveProperty("password_hash");
    expect(row).not.toHaveProperty("security_key_hash");
    expect(row.must_change_password).toBe(0);
    expect(row.basic_salary_cents).toBe(45050);
    expect(row.school_id).toBe("SSV");
  });

  it("moves logo bytes out of the row, for R2", () => {
    const { row, blobs } = normalizeRow("school_logo_renditions", { school_id: "SSV ", size: 16, png: "\\x89504e47" });
    expect(row).toEqual({ school_id: "SSV", size: 16, png_r2_key: "logos/SSV/r16.png" });
    expect(blobs).toHaveLength(1);
    expect([...blobs[0].bytes]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(blobs[0].contentType).toBe("image/png");
  });

  it("stores JSON as text and quotes SQL safely", () => {
    const { row } = normalizeRow("audit_log", { audit_id: 1, detail: { a: "it's" }, summary: "x", school_id: null });
    expect(row.detail).toBe('{"a":"it\'s"}');
    const [sql] = upsertStatements("audit_log", [row]);
    expect(sql).toContain(`'{"a":"it''s"}'`);
  });

  it("splits large upserts under the D1 statement limit", () => {
    const rows = Array.from({ length: 3000 }, (_, i) => ({ audit_id: i, summary: "x".repeat(100) }));
    const statements = upsertStatements("audit_log", rows);
    expect(statements.length).toBeGreaterThan(1);
    for (const s of statements) expect(s.length).toBeLessThan(100_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The website only opens for a valid Cloudflare Access token.

describe("website access", () => {
  const env = { ACCESS_TEAM_DOMAIN: "school.cloudflareaccess.com", ACCESS_AUD: "aud-123" };
  const b64url = (data: string | ArrayBuffer) =>
    Buffer.from(typeof data === "string" ? Buffer.from(data) : new Uint8Array(data)).toString("base64url");

  async function setup() {
    const keys = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"]
    );
    const jwk = { ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid: "k1" };
    vi.stubGlobal("fetch", async (url: string) =>
      String(url) === "https://school.cloudflareaccess.com/cdn-cgi/access/certs" ? Response.json({ keys: [jwk] }) : new Response("no", { status: 404 })
    );
    const token = async (claims: Record<string, unknown>) => {
      const head = b64url(JSON.stringify({ alg: "RS256", kid: "k1" }));
      const body = b64url(JSON.stringify(claims));
      const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(`${head}.${body}`));
      return `${head}.${body}.${b64url(signature)}`;
    };
    return token;
  }
  const request = (jwt?: string) => new Request("https://site.example/", jwt ? { headers: { "Cf-Access-Jwt-Assertion": jwt } } : {});
  const exp = () => Math.floor(Date.now() / 1000) + 600;

  afterAll(() => vi.unstubAllGlobals());

  it("lets in a valid token, and nothing else", async () => {
    const token = await setup();
    const good = await token({ aud: ["aud-123"], exp: exp(), email: "head@school", iss: "https://school.cloudflareaccess.com" });
    expect(await verifyAccess(request(good), env)).toEqual({ email: "head@school", via: "access" });

    expect(await verifyAccess(request(), env)).toBeNull();
    expect(await verifyAccess(request(await token({ aud: ["other-app"], exp: exp() })), env)).toBeNull();
    expect(await verifyAccess(request(await token({ aud: ["aud-123"], exp: Math.floor(Date.now() / 1000) - 5 })), env)).toBeNull();
    const [h, , s] = good.split(".");
    const forgedBody = b64url(JSON.stringify({ aud: ["aud-123"], exp: exp(), email: "intruder@x" }));
    expect(await verifyAccess(request(`${h}.${forgedBody}.${s}`), env)).toBeNull();
  });

  it("refuses everything when Access is not configured", async () => {
    const token = await setup();
    const good = await token({ aud: ["aud-123"], exp: exp(), email: "head@school" });
    expect(await verifyAccess(request(good), {})).toBeNull();
    // The local-development switch only works on localhost.
    expect(await verifyAccess(request(), { DEV_ALLOW_UNAUTHENTICATED: "true" })).toBeNull();
    expect(await verifyAccess(new Request("http://localhost:8787/"), { DEV_ALLOW_UNAUTHENTICATED: "true" })).toEqual({ email: "local developer", via: "local" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Desktop (Postgres) → Worker (node:sqlite standing in for D1), end to end.

const DB_NAME = "ruzivo_sync_test";
const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");
const D1_MIGRATIONS = path.resolve(__dirname, "../cloud/d1/migrations");
const LINK_CODE = "test-link-code-0123456789";

const connection = (database: string) => ({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database,
});

async function adminQuery(sql: string) {
  const admin = new Client(connection(process.env.PGADMINDB || "postgres"));
  await admin.connect();
  try {
    await admin.query(sql);
  } finally {
    await admin.end();
  }
}

const migrate: MigrateFn = async ({ schema, count }) => {
  await runner({
    databaseUrl: connection(DB_NAME),
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

/** node:sqlite behind the subset of the D1 API the Worker uses. */
class SqliteStatement implements Statement {
  constructor(private db: DatabaseSync, readonly sql: string, private params: unknown[] = []) {}
  bind(...values: unknown[]) {
    return new SqliteStatement(this.db, this.sql, values);
  }
  async first<T>() {
    return ((this.db.prepare(this.sql).get(...(this.params as never[])) as T) ?? null);
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...(this.params as never[])) as T[] };
  }
  async run() {
    return this.runNow();
  }
  runNow() {
    return this.db.prepare(this.sql).run(...(this.params as never[]));
  }
}

class SqliteD1 implements Database {
  constructor(readonly db: DatabaseSync) {}
  prepare(sql: string) {
    return new SqliteStatement(this.db, sql);
  }
  async batch(statements: Statement[]) {
    this.db.exec("BEGIN");
    try {
      const results = statements.map((s) => (s as SqliteStatement).runNow());
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

let pool: Pool;
let sqlite: DatabaseSync;
let d1: SqliteD1;
let server: Server;
let workerUrl: string;
let link: SyncLink;
const r2 = new Map<string, Uint8Array>();
const sentBodies: string[] = [];

async function startWorker() {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString("utf8");
    sentBodies.push(body);
    const reply =
      req.url === "/sync/link"
        ? await handleLink(d1, LINK_CODE, body)
        : await handleBatch(
            d1,
            {
              install: (req.headers["x-ruzivo-install"] as string) ?? null,
              timestamp: (req.headers["x-ruzivo-timestamp"] as string) ?? null,
              signature: (req.headers["x-ruzivo-signature"] as string) ?? null,
            },
            body,
            async (key, bytes) => void r2.set(key, bytes)
          ).catch((error) => ({ status: 500, body: { ok: false, error: String(error) } }));
    res.writeHead(reply.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(reply.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  workerUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}

async function seed() {
  const one = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];
  await pool.query(`INSERT INTO schools (school_id, school_name) VALUES ('SYN', 'Sync Test Primary')`);
  const gender = await one(`INSERT INTO genders (school_id, gender_name) VALUES ('SYN', 'Female') RETURNING gender_id`);
  const klass = await one(`INSERT INTO class_categories (school_id, class_name) VALUES ('SYN', 'Grade 1') RETURNING class_category_id`);
  const year = await one(`INSERT INTO academic_years (school_id, academic_year_name, start_date, end_date) VALUES ('SYN', '2026', '2026-01-01', '2026-12-31') RETURNING academic_year_id`);
  const period = await one(`INSERT INTO payment_periods (school_id, period_name) VALUES ('SYN', 'January') RETURNING payment_period_id`);
  await pool.query(`INSERT INTO payment_periods (school_id, period_name) VALUES ('SYN', 'February')`);
  const method = await one(`INSERT INTO payment_methods (school_id, method_name) VALUES ('SYN', 'Cash') RETURNING payment_method_id`);
  const fee = await one(`INSERT INTO income_categories (school_id, income_name, income_limit) VALUES ('SYN', 'Tuition', 300.00) RETURNING income_category_id`);
  const role = await one(`INSERT INTO roles (school_id, role_name, access_level) VALUES ('SYN', 'Administrator', 'ADMIN') RETURNING role_id`);
  await pool.query(
    `INSERT INTO employees (school_id, first_name, last_name, email, password_hash, role_id, basic_salary) VALUES ('SYN', 'Tari', 'Moyo', 't@syn', 'scrypt$do-not-send', $1, 500.25)`,
    [role.role_id]
  );
  const cat = await one(`INSERT INTO expense_categories (school_id, expense_name) VALUES ('SYN', 'Fuel') RETURNING expense_category_id`);
  await pool.query(`INSERT INTO expenses (expense_category_id, amount, expense_date, description) VALUES ($1, 100.00, '2026-09-07', 'Diesel')`, [cat.expense_category_id]);
  for (const [id, first] of [["SYN00001", "Rudo"], ["SYN00002", "Tendai"]]) {
    await pool.query(
      `INSERT INTO learners (learner_id, school_id, first_name, last_name, gender_id, date_of_birth) VALUES ($1, 'SYN', $2, 'Ncube', $3, '2016-03-04')`,
      [id, first, gender.gender_id]
    );
    await pool.query(`INSERT INTO enrolments (learner_id, class_category_id, academic_year_id) VALUES ($1, $2, $3)`, [id, klass.class_category_id, year.academic_year_id]);
  }
  const enrolment = await one(`SELECT enrolment_id FROM enrolments WHERE learner_id = 'SYN00001'`);
  for (const amount of ["100.10", "0.01"]) {
    const charge = await one(
      `INSERT INTO charges (learner_id, enrolment_id, income_category_id, payment_period_id, academic_year_id) VALUES ('SYN00001', $1, $2, $3, $4) RETURNING charge_id`,
      [enrolment.enrolment_id, fee.income_category_id, period.payment_period_id, year.academic_year_id]
    );
    const payment = await one(`INSERT INTO payments (amount, payment_method_id) VALUES ($1, $2) RETURNING payment_id`, [amount, method.payment_method_id]);
    await pool.query(`INSERT INTO payment_allocations (payment_id, charge_id) VALUES ($1, $2)`, [payment.payment_id, charge.charge_id]);
  }
  await pool.query(`INSERT INTO school_logos (school_id, original, ico) VALUES ('SYN', $1, $2)`, [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 255]), Buffer.from([0, 0, 1, 0])]);
  await pool.query(`INSERT INTO school_logo_renditions (school_id, size, png) VALUES ('SYN', 64, $1)`, [Buffer.from([0x89, 0x50, 1, 2])]);
}

/** Row counts per mirrored table, in Postgres and in the mirror. */
async function counts() {
  const pg: Record<string, number> = {};
  const mirror: Record<string, number> = {};
  for (const table of TABLE_ORDER) {
    pg[table] = (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
    mirror[table] = Number((sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n);
  }
  return { pg, mirror };
}

const mirrorRow = (sql: string, ...params: (string | number)[]) => sqlite.prepare(sql).get(...params) as Record<string, unknown> | undefined;

beforeAll(async () => {
  await adminQuery(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
  await adminQuery(`CREATE DATABASE "${DB_NAME}"`);
  await migrate({ schema: "public" });
  pool = new Pool({ ...connection(DB_NAME), max: 4 });

  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const file of (await readdir(D1_MIGRATIONS)).filter((f) => f.endsWith(".sql")).sort()) {
    sqlite.exec(await readFile(path.join(D1_MIGRATIONS, file), "utf8"));
  }
  d1 = new SqliteD1(sqlite);
  resetColumnCache();
  await startWorker();
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await new Promise((resolve) => server?.close(resolve));
  sqlite?.close();
  await adminQuery(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
});

describe("change capture (migration 014)", () => {
  it("queues the key of every inserted, updated and deleted row", async () => {
    await pool.query("TRUNCATE sync_outbox");
    await seed();
    const entries = await readOutbox(pool as never, 10_000);
    const tables = new Set(entries.map((e) => e.table));
    for (const t of ["schools", "learners", "payments", "payment_allocations", "school_logos", "employees", "expenses"]) expect(tables).toContain(t);
    expect(entries.find((e) => e.table === "school_logo_renditions")?.pk).toEqual({ school_id: "SYN ", size: 64 });
  });

  it("turns the queue into the rows' current state, deriving payment and expense schools", async () => {
    const client = await pool.connect();
    try {
      const collected = await collectChanges(client, await readOutbox(client, 10_000));
      const payments = collected.changes.find((c) => c.table === "payments" && c.op === "upsert");
      expect(payments && "rows" in payments && payments.rows.every((r) => r.school_id === "SYN")).toBe(true);
      const expenses = collected.changes.find((c) => c.table === "expenses" && c.op === "upsert");
      expect(expenses && "rows" in expenses && expenses.rows[0].school_id).toBe("SYN");
      expect(collected.blobs.map((b) => b.key).sort()).toEqual(["logos/SYN/logo.ico", "logos/SYN/original", "logos/SYN/r64.png"]);
    } finally {
      client.release();
    }
  });
});

describe("syncing to the Worker", () => {
  it("links with the link code, and refuses a wrong one", async () => {
    const bad = await fetch(`${workerUrl}/sync/link`, { method: "POST", body: JSON.stringify({ linkCode: "nope", installId: crypto.randomUUID() }) });
    expect(bad.status).toBe(401);

    const installId = crypto.randomUUID();
    const response = await fetch(`${workerUrl}/sync/link`, { method: "POST", body: JSON.stringify({ linkCode: LINK_CODE, installId, label: "test" }) });
    const body = (await response.json()) as { ok: boolean; secret: string };
    expect(body.ok).toBe(true);
    link = { workerUrl, installId, secret: body.secret };
  });

  it("sends a full copy first, matching Postgres row for row", async () => {
    const result = await runSync(pool, link, "9.9.9");
    expect(result.mode).toBe("full");
    const { pg, mirror } = await counts();
    expect(mirror).toEqual(pg);
    expect((await pool.query("SELECT count(*)::int AS n FROM sync_outbox")).rows[0].n).toBe(0);
    expect((await pool.query("SELECT value FROM sync_state WHERE key = 'needs_full_sync'")).rows[0].value).toBe("false");

    const total = (await pool.query("SELECT sum(amount)::text AS s FROM payments")).rows[0].s;
    expect(mirrorRow("SELECT sum(amount_cents) AS c FROM payments")!.c).toBe(toCents(total));
    expect(mirrorRow("SELECT school_id FROM payments LIMIT 1")!.school_id).toBe("SYN");
    expect(mirrorRow("SELECT basic_salary_cents FROM employees")!.basic_salary_cents).toBe(50025);
    expect([...r2.get("logos/SYN/original")!]).toEqual([0x89, 0x50, 0x4e, 0x47, 0, 255]);
    expect(sentBodies.some((b) => b.includes("scrypt$"))).toBe(false);
  });

  it("then sends only changes: new rows, edits and deletes", async () => {
    const allocation = (await pool.query("SELECT payment_id, charge_id FROM payment_allocations ORDER BY allocation_id LIMIT 1")).rows[0];
    await pool.query("DELETE FROM payment_allocations WHERE payment_id = $1", [allocation.payment_id]);
    await pool.query("DELETE FROM payments WHERE payment_id = $1", [allocation.payment_id]);
    await pool.query("UPDATE learners SET first_name = 'Rudorwashe' WHERE learner_id = 'SYN00001'");
    // A period renamed, and its old name reused at once (unique names in Postgres).
    await pool.query("UPDATE payment_periods SET period_name = 'Jan (old)' WHERE period_name = 'January' AND school_id = 'SYN'");
    await pool.query("INSERT INTO payment_periods (school_id, period_name) VALUES ('SYN', 'January')");

    const result = await runSync(pool, link, "9.9.9");
    expect(result.mode).toBe("delta");
    const { pg, mirror } = await counts();
    expect(mirror).toEqual(pg);
    expect(mirrorRow("SELECT 1 AS x FROM payments WHERE payment_id = ?", allocation.payment_id)).toBeUndefined();
    expect(mirrorRow("SELECT first_name FROM learners WHERE learner_id = 'SYN00001'")!.first_name).toBe("Rudorwashe");
    expect(mirrorRow("SELECT count(*) AS n FROM payment_periods WHERE period_name = 'January'")!.n).toBe(1);

    const again = await runSync(pool, link, "9.9.9");
    expect(again.mode).toBe("idle");
  });

  it("ignores a batch sent twice, and refuses a forged one", async () => {
    const last = sentBodies[sentBodies.length - 1];
    const resend = await fetch(`${workerUrl}/sync/batch`, {
      method: "POST",
      headers: { "X-Ruzivo-Install": link.installId, ...signBody(link.secret, last) },
      body: last,
    });
    expect(await resend.json()).toMatchObject({ ok: true, duplicate: true });

    const forged = last.replace("Rudorwashe", "Hacked");
    const tampered = await fetch(`${workerUrl}/sync/batch`, {
      method: "POST",
      headers: { "X-Ruzivo-Install": link.installId, ...signBody(link.secret, last) },
      body: forged,
    });
    expect(tampered.status).toBe(401);
  });

  it("matches the desktop's own amounts owing", async () => {
    const pgRows = (await pool.query(`${OBLIGATIONS_CTE} SELECT count(*)::int AS n, coalesce(sum(balance), 0)::text AS b, coalesce(sum(paid), 0)::text AS p FROM obligations`, ["SYN"])).rows[0];
    const d1Row = mirrorRow("SELECT count(*) AS n, coalesce(sum(balance_cents), 0) AS b, coalesce(sum(paid_cents), 0) AS p FROM v_obligations WHERE school_id = 'SYN'")!;
    expect(d1Row.n).toBe(pgRows.n);
    expect(d1Row.b).toBe(toCents(pgRows.b));
    expect(d1Row.p).toBe(toCents(pgRows.p));
  });

  it("renders every website page from the mirror", async () => {
    for (const path of ["/", "/learners", "/learners?q=Rud", "/learners/SYN00001", "/payments?from=2020-01-01", "/expenses?month=2026-09", "/staff", "/nope"]) {
      const response = await renderSite(new Request(`https://site.test${path}`), d1, { TIMEZONE: "Africa/Harare" }, { email: "viewer@test" });
      const html = await response.text();
      expect(response.status, path).toBe(path === "/nope" ? 404 : 200);
      expect(html, path).toContain("Sync Test Primary");
      expect(html, path).not.toMatch(/undefined|NaN|\[object Object\]/);
    }
    const learner = await (await renderSite(new Request("https://site.test/learners/SYN00001"), d1, {}, { email: "v" })).text();
    expect(learner).toContain("Rudorwashe");
    expect(learner).toContain("$300.00");
    // Text from the database is escaped, never markup.
    await pool.query("UPDATE learners SET last_name = '<script>x</script>' WHERE learner_id = 'SYN00002'");
    await runSync(pool, link, "9.9.9");
    const list = await (await renderSite(new Request("https://site.test/learners"), d1, {}, { email: "v" })).text();
    expect(list).not.toContain("<script>x");
    expect(list).toContain("&lt;script&gt;x");
  });

  it("signs in with the website password, and slows down guessing", async () => {
    const env = { SITE_PASSWORD: "correct horse battery" };
    const login = (password: string, ip = "198.51.100.7") =>
      handleLogin(
        new Request("https://site.test/login", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": ip },
          body: new URLSearchParams({ password }),
        }),
        env,
        d1
      );

    const ok = await login("correct horse battery");
    expect(ok.status).toBe(303);
    const cookie = ok.headers.get("Set-Cookie")!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    const session = cookie.split(";")[0];
    expect(await sessionViewer(new Request("https://site.test/", { headers: { Cookie: session } }), env)).toMatchObject({ via: "password" });

    // A forged, expired or old-password session gets nothing.
    const [expires, signature] = session.split("=")[1].split(".");
    const forged = `ruzivo_session=${Number(expires) + 99999}.${signature}`;
    expect(await sessionViewer(new Request("https://site.test/", { headers: { Cookie: forged } }), env)).toBeNull();
    expect(await sessionViewer(new Request("https://site.test/", { headers: { Cookie: session } }), { SITE_PASSWORD: "a different password" })).toBeNull();
    expect(await sessionViewer(new Request("https://site.test/"), env)).toBeNull();
    expect(await sessionViewer(new Request("https://site.test/", { headers: { Cookie: session } }), { SITE_PASSWORD: "short" })).toBeNull();

    for (let i = 0; i < 10; i++) expect((await login("guess" + i)).status).toBe(401);
    // Locked out now, even with the right password, but only this connection.
    expect((await login("correct horse battery")).status).toBe(429);
    expect((await login("correct horse battery", "203.0.113.9")).status).toBe(303);
  });

  it("after a restore, resends everything and removes rows the restore took away", async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), "ruzivo-sync-test-"));
    try {
      const backup = await createBackup(pool, { parentDir: folder, appVersion: "9.9.9", createdBy: "test", skipReadableCopy: true });
      // Recorded after the backup, so the restore takes it away again.
      await pool.query("INSERT INTO learners (learner_id, school_id, first_name, last_name) VALUES ('SYN00099', 'SYN', 'Late', 'Arrival')");
      await runSync(pool, link, "9.9.9");
      expect(mirrorRow("SELECT 1 AS x FROM learners WHERE learner_id = 'SYN00099'")).toBeDefined();

      const manifest = await readBackup(backup.path, MIGRATIONS_DIR);
      expect(manifest.tables.map((t) => t.name)).not.toContain("sync_outbox");
      await restoreBackup(pool, backup.path, manifest, migrate);

      expect((await pool.query("SELECT count(*)::int AS n FROM sync_outbox")).rows[0].n).toBe(0);
      expect((await pool.query("SELECT value FROM sync_state WHERE key = 'needs_full_sync'")).rows[0].value).toBe("true");

      const result = await runSync(pool, link, "9.9.9");
      expect(result.mode).toBe("full");
      expect(mirrorRow("SELECT 1 AS x FROM learners WHERE learner_id = 'SYN00099'")).toBeUndefined();
      const { pg, mirror } = await counts();
      expect(mirror).toEqual(pg);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }, 120_000);

  it("stops a computer once another one is linked", async () => {
    const response = await fetch(`${workerUrl}/sync/link`, { method: "POST", body: JSON.stringify({ linkCode: LINK_CODE, installId: crypto.randomUUID() }) });
    expect(response.ok).toBe(true);
    await pool.query("UPDATE learners SET last_name = 'Dube' WHERE learner_id = 'SYN00002'");
    await expect(runSync(pool, link, "9.9.9")).rejects.toMatchObject({ code: "revoked" });
    await expect(runSync(pool, link, "9.9.9")).rejects.toBeInstanceOf(SyncError);
    // Nothing was lost: the change is still queued for whichever computer syncs next.
    expect((await pool.query("SELECT count(*)::int AS n FROM sync_outbox")).rows[0].n).toBeGreaterThan(0);
  });
});

// Optional: the real thing. RUZIVO_SYNC_TEST_BACKUP=<backup folder> restores a
// real backup into the test database, syncs it, and compares every table and
// the amounts owing with Postgres.
const realBackup = process.env.RUZIVO_SYNC_TEST_BACKUP;
describe.skipIf(!realBackup || !existsSync(realBackup))("a real backup, end to end", () => {
  it("restores, syncs, and matches Postgres", async () => {
    const manifest = await readBackup(realBackup!, MIGRATIONS_DIR);
    await restoreBackup(pool, realBackup!, manifest, migrate);
    const installId = crypto.randomUUID();
    const response = await fetch(`${workerUrl}/sync/link`, { method: "POST", body: JSON.stringify({ linkCode: LINK_CODE, installId }) });
    const { secret } = (await response.json()) as { secret: string };
    const realLink: SyncLink = { workerUrl, installId, secret };
    const result = await runSync(pool, realLink, "9.9.9");
    expect(result.mode).toBe("full");
    const { pg, mirror } = await counts();
    expect(mirror).toEqual(pg);

    for (const { school_id } of manifest.summary.schools) {
      const pgRows = (await pool.query(`${OBLIGATIONS_CTE} SELECT count(*)::int AS n, coalesce(sum(balance), 0)::text AS b, coalesce(sum(paid), 0)::text AS p FROM obligations`, [school_id])).rows[0];
      const d1Row = mirrorRow("SELECT count(*) AS n, coalesce(sum(balance_cents), 0) AS b, coalesce(sum(paid_cents), 0) AS p FROM v_obligations WHERE school_id = ?", school_id.trim())!;
      expect({ n: d1Row.n, b: d1Row.b, p: d1Row.p }).toEqual({ n: pgRows.n, b: toCents(pgRows.b), p: toCents(pgRows.p) });
    }

    // RUZIVO_SYNC_TEST_PAGES=<folder> also saves the website's pages, to look at.
    const pagesDir = process.env.RUZIVO_SYNC_TEST_PAGES;
    const firstLearner = mirrorRow("SELECT learner_id FROM v_learner_balances ORDER BY total_owing_cents DESC LIMIT 1")?.learner_id;
    for (const [name, route] of [["overview", "/"], ["learners", "/learners"], ["learner", `/learners/${firstLearner}`], ["payments", "/payments?from=2026-01-01"], ["expenses", "/expenses?month=2026-09"], ["staff", "/staff"]]) {
      const response = await renderSite(new Request(`https://site.test${route}`), d1, { TIMEZONE: "Africa/Harare" }, { email: "viewer@test" });
      const html = await response.text();
      expect(response.status, route).toBe(200);
      expect(html, route).not.toMatch(/undefined|NaN|\[object Object\]/);
      if (pagesDir) await writeFile(path.join(pagesDir, `${name}.html`), html);
    }
  }, 300_000);
});
