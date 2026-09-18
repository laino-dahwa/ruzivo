import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runner } from "node-pg-migrate";
import path from "node:path";
import { Pool } from "pg";

/**
 * Own throwaway database, for the same reason as auth.api.test.ts: these
 * routes are behind the administrator guard, so the suite has to create an
 * administrator and sign in — which it must not do to the developer's real
 * database.
 */
const TEST_DATABASE = "ruzivo_documents_test";
const migrationsDir = path.join(__dirname, "..", "migrations");
const SCHOOL = "DOC";
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
let GET_DOCUMENTS: Handler;
let POST_DOCUMENTS: Handler;
let GET_DOCUMENT: Handler;
let query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, never>[]; rowCount: number | null }>;

let adminToken = "";
let cashierToken = "";
let learnerId = "";

function request(url: string, init?: RequestInit & { token?: string }) {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  if (init?.token) headers.set("cookie", `ssv_session=${init.token}`);
  return new Request(url, { ...init, headers });
}

function post(url: string, body: unknown, token?: string) {
  return request(url, { method: "POST", body: JSON.stringify(body), token });
}

function params(values: Record<string, string>) {
  return { params: Promise.resolve(values) };
}

function tokenFrom(response: Response): string {
  const match = /ssv_session=([^;]*)/.exec(response.headers.get("set-cookie") ?? "");
  return decodeURIComponent(match?.[1] ?? "");
}

const DOCUMENTS_URL = `http://localhost/api/schools/${SCHOOL}/documents`;

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
  ({ GET: GET_DOCUMENTS, POST: POST_DOCUMENTS } = (await import("../app/api/schools/[school_id]/documents/route")) as unknown as {
    GET: Handler;
    POST: Handler;
  });
  ({ GET: GET_DOCUMENT } = (await import("../app/api/schools/[school_id]/documents/[document_id]/route")) as unknown as { GET: Handler });

  await query(`INSERT INTO schools (school_id, school_name, school_contact) VALUES ($1, $2, $3)`, [SCHOOL, "Document Test School", "0800 000 000"]);

  const bootstrap = await POST_BOOTSTRAP(
    post("http://localhost/api/auth/bootstrap", { first_name: "Ada", last_name: "Admin", password: ADMIN_PASSWORD, school_id: SCHOOL })
  );
  adminToken = tokenFrom(bootstrap);

  // A learner with one charge and a part payment, so the statement has
  // something real to report.
  const { createGender } = await import("../repositories/school/create/createGenderCategory");
  const { createClassCategory } = await import("../repositories/school/create/createClassCategory");
  const { createAcademicYear } = await import("../repositories/school/create/createAcademicYear");
  const { createIncomeCategory } = await import("../repositories/school/create/createIncomeCategory");
  const { createPaymentPeriod } = await import("../repositories/school/create/createPaymentPeriod");
  const { createPaymentMethod } = await import("../repositories/school/create/createPaymentMethod");
  const { createLearners } = await import("../repositories/learner/create/addLearner");
  const { createChargesWithPayments } = await import("../repositories/payment/create/createNewPayment");

  const [gender] = await createGender([{ school_id: SCHOOL, gender_name: "Female" }]);
  const [classCategory] = await createClassCategory([{ school_id: SCHOOL, class_name: "Grade 4" }]);
  const [year] = await createAcademicYear([{ school_id: SCHOOL, academic_year_name: "2026", start_date: "2026-01-01", end_date: "2026-12-31" }]);
  const [fee] = await createIncomeCategory([{ school_id: SCHOOL, income_name: "School Fees", income_limit: "500" }]);
  const [period] = await createPaymentPeriod([{ school_id: SCHOOL, period_name: "January" }]);
  const [method] = await createPaymentMethod([{ school_id: SCHOOL, method_name: "Cash" }]);

  const [learner] = await createLearners([{
    school_id: SCHOOL,
    first_name: "Tendai",
    last_name: "Moyo",
    gender_id: gender.gender_id,
    date_of_birth: "2015-01-01",
    class_category_id: classCategory.class_category_id,
    academic_year_id: year.academic_year_id,
  }]);
  learnerId = learner.learner_id;

  const enrolment = await query(`SELECT enrolment_id FROM enrolments WHERE learner_id = $1`, [learnerId]);
  await createChargesWithPayments({
    learner_id: learnerId,
    enrolment_id: Number(enrolment.rows[0].enrolment_id),
    payment_period_id: Number(period.payment_period_id),
    academic_year_id: Number(year.academic_year_id),
    payment_method_id: Number(method.payment_method_id),
    income_categories: [{ income_category_id: Number(fee.income_category_id), amount: 200 }],
  });

  // A cashier, to prove the guard actually refuses one.
  const role = await query(`INSERT INTO roles (school_id, role_name) VALUES ($1, 'Cashier') RETURNING role_id`, [SCHOOL]);
  const { createEmployees } = await import("../repositories/employee/create/createEmployee");
  const [cashier] = await createEmployees([{ school_id: SCHOOL, first_name: "Cass", last_name: "Hier", role_id: Number(role.rows[0].role_id) }]);
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

function letter(overrides: Record<string, unknown> = {}) {
  return {
    document_type: "transfer_letter",
    learner_id: learnerId,
    title: "Transfer Letter",
    body_html: "<p>This is to confirm that <strong>Tendai Moyo</strong> is leaving.</p>",
    signatory_name: "J. Moyo",
    signatory_title: "Head Teacher",
    ...overrides,
  };
}

describe("who may issue documents", () => {
  it("refuses a request with no session at all", async () => {
    const response = await POST_DOCUMENTS(post(DOCUMENTS_URL, letter()), params({ school_id: SCHOOL }));
    expect(response.status).toBe(401);
  });

  it("refuses a cashier, who may take money but not issue school correspondence", async () => {
    const response = await POST_DOCUMENTS(post(DOCUMENTS_URL, letter(), cashierToken), params({ school_id: SCHOOL }));
    expect(response.status).toBe(403);

    const listed = await GET_DOCUMENTS(request(DOCUMENTS_URL, { token: cashierToken }), params({ school_id: SCHOOL }));
    expect(listed.status).toBe(403);
  });
});

describe("issuing a document", () => {
  it("assigns a reference and records who issued it", async () => {
    const response = await POST_DOCUMENTS(post(DOCUMENTS_URL, letter(), adminToken), params({ school_id: SCHOOL }));
    expect(response.status).toBe(201);

    const created = await response.json();
    expect(created.reference).toMatch(/^DOC-TL-\d{6}$/);

    const row = await query(`SELECT issued_by_label, body_html, learner_id FROM documents WHERE document_id = $1`, [created.document_id]);
    expect(row.rows[0].issued_by_label).toBe("Ada Admin");
    // Stored exactly as issued, so a reprint matches the copy handed over.
    expect(row.rows[0].body_html).toContain("<strong>Tendai Moyo</strong>");
    expect(row.rows[0].learner_id).toBe(learnerId);
  });

  it("gives each document its own reference", async () => {
    const first = await (await POST_DOCUMENTS(post(DOCUMENTS_URL, letter(), adminToken), params({ school_id: SCHOOL }))).json();
    const second = await (await POST_DOCUMENTS(post(DOCUMENTS_URL, letter(), adminToken), params({ school_id: SCHOOL }))).json();
    expect(first.reference).not.toBe(second.reference);
  });

  it("writes an audit entry naming the document", async () => {
    const created = await (await POST_DOCUMENTS(post(DOCUMENTS_URL, letter(), adminToken), params({ school_id: SCHOOL }))).json();
    const audit = await query(`SELECT action, summary, actor_label FROM audit_log WHERE entity_type = 'document' AND entity_id = $1`, [String(created.document_id)]);
    expect(audit.rows[0].action).toBe("document.issue");
    expect(audit.rows[0].actor_label).toBe("Ada Admin");
    expect(audit.rows[0].summary).toContain(created.reference);
  });

  it("refuses a transfer letter with no learner", async () => {
    const response = await POST_DOCUMENTS(post(DOCUMENTS_URL, letter({ learner_id: null }), adminToken), params({ school_id: SCHOOL }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/must be issued for a learner/i);
  });

  it("allows a newsletter with no learner at all", async () => {
    const response = await POST_DOCUMENTS(
      post(DOCUMENTS_URL, letter({ document_type: "newsletter", learner_id: null, title: "Term Newsletter" }), adminToken),
      params({ school_id: SCHOOL })
    );
    expect(response.status).toBe(201);
    expect((await response.json()).reference).toMatch(/^DOC-NL-\d{6}$/);
  });

  it("refuses an empty document, and one nobody has signed", async () => {
    expect((await POST_DOCUMENTS(post(DOCUMENTS_URL, letter({ body_html: "   " }), adminToken), params({ school_id: SCHOOL }))).status).toBe(400);
    expect((await POST_DOCUMENTS(post(DOCUMENTS_URL, letter({ signatory_name: "" }), adminToken), params({ school_id: SCHOOL }))).status).toBe(400);
  });

  it("refuses an unknown document type", async () => {
    const response = await POST_DOCUMENTS(post(DOCUMENTS_URL, letter({ document_type: "ransom_note" }), adminToken), params({ school_id: SCHOOL }));
    expect(response.status).toBe(400);
  });
});

describe("statement of account", () => {
  it("takes its figures from the records, not from the request", async () => {
    const response = await POST_DOCUMENTS(
      post(
        DOCUMENTS_URL,
        letter({
          document_type: "fee_statement",
          title: "Statement of Account",
          // A caller claiming the account is settled must have no effect.
          statement: { lines: [], totalCharged: "$0.00", totalPaid: "$9,999.00", totalBalance: "$0.00" },
        }),
        adminToken
      ),
      params({ school_id: SCHOOL })
    );
    expect(response.status).toBe(201);

    const created = await response.json();
    const row = await query(`SELECT statement_data FROM documents WHERE document_id = $1`, [created.document_id]);
    const stored = row.rows[0].statement_data as unknown as { totalCharged: string; totalPaid: string; totalBalance: string; lines: unknown[] };

    // 500 charged, 200 paid — the real figures, not the submitted ones.
    expect(stored.totalCharged).toContain("500");
    expect(stored.totalPaid).toContain("200");
    expect(stored.totalBalance).toContain("300");
    expect(stored.lines).toHaveLength(1);
  });
});

describe("downloading and reprinting", () => {
  it("renders a PDF for an issued document", async () => {
    const created = await (await POST_DOCUMENTS(post(DOCUMENTS_URL, letter(), adminToken), params({ school_id: SCHOOL }))).json();

    const response = await GET_DOCUMENT(
      request(`${DOCUMENTS_URL}/${created.document_id}`, { token: adminToken }),
      params({ school_id: SCHOOL, document_id: String(created.document_id) })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(1000);
    // A real PDF, not an error page rendered by accident.
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("produces byte-identical output when reprinted", async () => {
    const created = await (await POST_DOCUMENTS(post(DOCUMENTS_URL, letter(), adminToken), params({ school_id: SCHOOL }))).json();
    const fetchPdf = async () =>
      new Uint8Array(
        await (
          await GET_DOCUMENT(
            request(`${DOCUMENTS_URL}/${created.document_id}`, { token: adminToken }),
            params({ school_id: SCHOOL, document_id: String(created.document_id) })
          )
        ).arrayBuffer()
      );

    const first = await fetchPdf();
    const second = await fetchPdf();
    // The copy on file has to match the copy the parent holds, or the
    // reference is worthless as proof.
    expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true);
  });

  it("refuses a document id that belongs to another school", async () => {
    await query(`INSERT INTO schools (school_id, school_name) VALUES ('DO2', 'Other School')`);
    const created = await (await POST_DOCUMENTS(post(DOCUMENTS_URL, letter(), adminToken), params({ school_id: SCHOOL }))).json();

    const response = await GET_DOCUMENT(
      request(`http://localhost/api/schools/DO2/documents/${created.document_id}`, { token: adminToken }),
      params({ school_id: "DO2", document_id: String(created.document_id) })
    );
    expect(response.status).toBe(404);
  });
});

describe("the issue history", () => {
  it("lists what was issued, newest first, and can be filtered by learner", async () => {
    const response = await GET_DOCUMENTS(request(DOCUMENTS_URL, { token: adminToken }), params({ school_id: SCHOOL }));
    expect(response.status).toBe(200);

    const rows = await response.json();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].issued_by_label).toBe("Ada Admin");

    const filtered = await GET_DOCUMENTS(request(`${DOCUMENTS_URL}?learner_id=${learnerId}`, { token: adminToken }), params({ school_id: SCHOOL }));
    const filteredRows = await filtered.json();
    expect(filteredRows.every((row: { learner_id: string }) => row.learner_id === learnerId)).toBe(true);
    // The newsletter issued earlier has no learner, so filtering must drop it.
    expect(filteredRows.length).toBeLessThan(rows.length);
  });
});
