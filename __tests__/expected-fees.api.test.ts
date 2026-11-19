import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runner } from "node-pg-migrate";
import path from "node:path";
import { Pool } from "pg";
import type { ExpectedFeeAction, ExpectedFeeFilters, ExpectedFeeRow, FeeKey } from "../types/expected-fees";

/**
 * Expected fees are suggestions; Balances is what is owed. These tests pin
 * down the rules in docs/expected-fees.md: what is suggested, what accepting
 * and denying do, how payments and their deletion interact with decisions,
 * and that nothing crosses between schools.
 *
 * Own throwaway database (like documents.api.test.ts): the routes sit behind
 * the sign-in guard, so the suite creates an administrator, which it must not
 * do to the developer's real database.
 */
const TEST_DATABASE = "ruzivo_expected_fees_test";
const migrationsDir = path.join(__dirname, "..", "migrations");
const SCHOOL = "EXF";
const OTHER_SCHOOL = "EXG";
const ADMIN_PASSWORD = "a-good-long-passphrase";
/** Inside the 2026 academic year, after March and before April. */
const TODAY = "2026-03-15";

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

let query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
let getExpectedFees: (school: string, filters: ExpectedFeeFilters, today?: string) => Promise<ExpectedFeeRow[]>;
let applyExpectedFeeAction: (school: string, action: ExpectedFeeAction, actor: { employee_id: number; label: string }, today?: string) => Promise<{ changed: number; unchanged: number; amount: number }>;
let getBalances: (...args: unknown[]) => Promise<Record<string, unknown>[]>;
let createChargesWithPayments: (input: unknown) => Promise<{ charge: { charge_id: number } }[]>;
let deleteCharge: (chargeId: number) => Promise<unknown>;
let GET_FEES: Handler;
let POST_DECISIONS: Handler;

let adminToken = "";
let adminId = 0;
const ids: Record<string, number> = {};
let methodId = 0;
let yearId = 0;
let otherSchoolFeeId = 0;
let learnerCounter = 0;

function request(url: string, init?: RequestInit & { token?: string }) {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  if (init?.token) headers.set("cookie", `ssv_session=${init.token}`);
  return new Request(url, { ...init, headers });
}

function params(values: Record<string, string>) {
  return { params: Promise.resolve(values) };
}

function tokenFrom(response: Response): string {
  const match = /ssv_session=([^;]*)/.exec(response.headers.get("set-cookie") ?? "");
  return decodeURIComponent(match?.[1] ?? "");
}

const actor = () => ({ employee_id: adminId, label: "Ada Admin" });
const decide = (action: ExpectedFeeAction) => applyExpectedFeeAction(SCHOOL, action, actor(), TODAY);
const pending = (filters: ExpectedFeeFilters = {}) => getExpectedFees(SCHOOL, { decision: "PENDING", ...filters }, TODAY);
const keyOf = (row: ExpectedFeeRow): FeeKey => ({
  learner_id: row.learner_id,
  income_category_id: row.income_category_id,
  payment_period_id: row.payment_period_id!,
  academic_year_id: row.academic_year_id!,
});
const owed = async (learnerId: string) =>
  (await getBalances(SCHOOL, learnerId, null, null, null, null, null, false)).map((row) => ({
    fee: row.income_name,
    period: row.period_name,
    charged: Number(row.charged),
    paid: Number(row.paid),
    balance: Number(row.balance),
  }));

async function enrol(className: "A" | "B" = "A", school = SCHOOL) {
  const { createLearners } = await import("../repositories/learner/create/addLearner");
  learnerCounter += 1;
  const [learner] = await createLearners([{
    school_id: school,
    first_name: `Learner${learnerCounter}`,
    last_name: "Test",
    gender_id: school === SCHOOL ? ids.gender : ids.otherGender,
    date_of_birth: "2015-01-01",
    class_category_id: school === SCHOOL ? (className === "A" ? ids.classA : ids.classB) : ids.otherClass,
    academic_year_id: school === SCHOOL ? yearId : ids.otherYear,
  }]);
  const enrolment = await query(`SELECT enrolment_id FROM enrolments WHERE learner_id = $1`, [learner.learner_id]);
  return { learnerId: String(learner.learner_id), enrolmentId: Number(enrolment.rows[0].enrolment_id) };
}

async function pay(learner: { learnerId: string; enrolmentId: number }, fee: number, period: number, amount: number) {
  const [created] = await createChargesWithPayments({
    learner_id: learner.learnerId,
    enrolment_id: learner.enrolmentId,
    payment_period_id: period,
    academic_year_id: yearId,
    payment_method_id: methodId,
    income_categories: [{ income_category_id: fee, amount }],
  });
  return created.charge.charge_id;
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
  await runner({ databaseUrl: { ...adminConfig(), database: TEST_DATABASE }, dir: migrationsDir, direction: "up", migrationsTable: "pgmigrations", log: () => {} });

  ({ query } = (await import("../lib/db")) as unknown as { query: typeof query });
  ({ getExpectedFees } = (await import("../repositories/expected-fees/getExpectedFees")) as unknown as { getExpectedFees: typeof getExpectedFees });
  ({ applyExpectedFeeAction } = (await import("../repositories/expected-fees/decideExpectedFees")) as unknown as { applyExpectedFeeAction: typeof applyExpectedFeeAction });
  ({ getBalances } = (await import("../repositories/payment/read/getBalances")) as unknown as { getBalances: typeof getBalances });
  ({ createChargesWithPayments } = (await import("../repositories/payment/create/createNewPayment")) as unknown as { createChargesWithPayments: typeof createChargesWithPayments });
  ({ deleteCharge } = (await import("../repositories/payment/delete/delete_payment")) as unknown as { deleteCharge: typeof deleteCharge });
  ({ GET: GET_FEES } = (await import("../app/api/schools/[school_id]/expected-fees/route")) as unknown as { GET: Handler });
  ({ POST: POST_DECISIONS } = (await import("../app/api/schools/[school_id]/expected-fees/decisions/route")) as unknown as { POST: Handler });
  const { POST: POST_BOOTSTRAP } = (await import("../app/api/auth/bootstrap/route")) as unknown as { POST: (r: Request) => Promise<Response> };

  await query(`INSERT INTO schools (school_id, school_name, school_contact) VALUES ($1, 'Expected Fees Test', 'n/a'), ($2, 'Expected Fees Other', 'n/a')`, [SCHOOL, OTHER_SCHOOL]);
  const bootstrap = await POST_BOOTSTRAP(request("http://localhost/api/auth/bootstrap", {
    method: "POST",
    body: JSON.stringify({ first_name: "Ada", last_name: "Admin", password: ADMIN_PASSWORD, school_id: SCHOOL }),
  }));
  adminToken = tokenFrom(bootstrap);
  adminId = Number((await query(`SELECT employee_id FROM employees WHERE school_id = $1 LIMIT 1`, [SCHOOL])).rows[0].employee_id);

  const { createGender } = await import("../repositories/school/create/createGenderCategory");
  const { createClassCategory } = await import("../repositories/school/create/createClassCategory");
  const { createAcademicYear } = await import("../repositories/school/create/createAcademicYear");
  const { createPaymentPeriod } = await import("../repositories/school/create/createPaymentPeriod");
  const { createPaymentMethod } = await import("../repositories/school/create/createPaymentMethod");
  const { createIncomeCategory } = await import("../repositories/school/create/createIncomeCategory");

  ids.gender = Number((await createGender([{ school_id: SCHOOL, gender_name: "Female" }]))[0].gender_id);
  ids.classA = Number((await createClassCategory([{ school_id: SCHOOL, class_name: "Class A" }]))[0].class_category_id);
  ids.classB = Number((await createClassCategory([{ school_id: SCHOOL, class_name: "Class B" }]))[0].class_category_id);
  yearId = Number((await createAcademicYear([{ school_id: SCHOOL, academic_year_name: "2026", start_date: "2026-01-01", end_date: "2026-12-31" }]))[0].academic_year_id);
  for (const name of ["January", "February", "March", "April", "Term A"]) {
    ids[name] = Number((await createPaymentPeriod([{ school_id: SCHOOL, period_name: name }]))[0].payment_period_id);
  }
  methodId = Number((await createPaymentMethod([{ school_id: SCHOOL, method_name: "Cash" }]))[0].payment_method_id);

  const fee = async (input: Record<string, unknown>) =>
    Number((await createIncomeCategory([{ school_id: SCHOOL, ...input } as never]))[0].income_category_id);
  ids.tuition = await fee({ income_name: "Tuition", income_limit: "100" });
  ids.bus = await fee({ income_name: "Bus", income_limit: "50", class_applicability: "SPECIFIC_CLASSES", class_category_ids: [ids.classB] });
  ids.lab = await fee({ income_name: "Lab", income_limit: "30", period_applicability: "SPECIFIC_PERIODS", payment_period_ids: [ids.March] });
  ids.unlimited = await fee({ income_name: "Unlimited", income_limit: null });
  ids.swimming = await fee({ income_name: "Swimming", income_limit: "20", priority: "OPTIONAL", period_applicability: "SPECIFIC_PERIODS", payment_period_ids: [ids.January, ids.February, ids.March, ids.April] });
  ids.uniform = await fee({ income_name: "Uniform", income_limit: "70", priority: "ONCE_OFF" });

  // A second school, to prove nothing crosses over.
  ids.otherGender = Number((await createGender([{ school_id: OTHER_SCHOOL, gender_name: "Female" }]))[0].gender_id);
  ids.otherClass = Number((await createClassCategory([{ school_id: OTHER_SCHOOL, class_name: "Other" }]))[0].class_category_id);
  ids.otherYear = Number((await createAcademicYear([{ school_id: OTHER_SCHOOL, academic_year_name: "2026", start_date: "2026-01-01", end_date: "2026-12-31" }]))[0].academic_year_id);
  await createPaymentPeriod([{ school_id: OTHER_SCHOOL, period_name: "January" }]);
  otherSchoolFeeId = Number((await createIncomeCategory([{ school_id: OTHER_SCHOOL, income_name: "Other Tuition", income_limit: "999" } as never]))[0].income_category_id);
});

afterAll(async () => {
  const { getPool } = await import("../lib/db");
  await (await getPool()).end();
  const admin = new Pool(adminConfig());
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DATABASE}`);
  } finally {
    await admin.end();
  }
});

describe("what is suggested", () => {
  it("suggests a mandatory fee for every started period, and owes nothing until accepted", async () => {
    const learner = await enrol("A");
    const rows = await pending({ learner_id: learner.learnerId, income_category_id: ids.tuition });
    // January to March have started on 15 March; April has not. "Term A" has
    // no dates, so it is always treated as started.
    expect(rows.map((r) => r.period_name).sort()).toEqual(["February", "January", "March", "Term A"]);
    expect(rows.every((r) => r.decision === "PENDING" && Number(r.amount) === 100)).toBe(true);
    expect(await owed(learner.learnerId)).toEqual([]);
  });

  it("brings a month in once it starts", async () => {
    const learner = await enrol("A");
    const april = await getExpectedFees(SCHOOL, { learner_id: learner.learnerId, income_category_id: ids.tuition, payment_period_id: ids.April }, "2026-04-01");
    expect(april).toHaveLength(1);
  });

  it("respects who and which periods a fee applies to", async () => {
    const inA = await enrol("A");
    const inB = await enrol("B");
    expect(await pending({ learner_id: inA.learnerId, income_category_id: ids.bus })).toHaveLength(0);
    expect(await pending({ learner_id: inB.learnerId, income_category_id: ids.bus })).not.toHaveLength(0);
    const lab = await pending({ learner_id: inA.learnerId, income_category_id: ids.lab });
    expect(lab.map((r) => r.period_name)).toEqual(["March"]);
  });

  it("never suggests a fee with no limit, an optional fee nobody took up, or a once-off fee", async () => {
    const learner = await enrol("A");
    for (const fee of [ids.unlimited, ids.swimming, ids.uniform]) {
      expect(await pending({ learner_id: learner.learnerId, income_category_id: fee })).toHaveLength(0);
    }
  });

  it("carries an optional fee forward once it is paid, into later started months only", async () => {
    const learner = await enrol("A");
    await pay(learner, ids.swimming, ids.January, 20);
    const rows = await pending({ learner_id: learner.learnerId, income_category_id: ids.swimming });
    expect(rows.map((r) => r.period_name).sort()).toEqual(["February", "March"]);
  });

  it("filters combine: class, fee and period together", async () => {
    const inB = await enrol("B");
    const rows = await pending({ class_category_id: ids.classB, income_category_id: ids.bus, payment_period_id: ids.February });
    expect(rows.some((r) => r.learner_id === inB.learnerId)).toBe(true);
    expect(rows.every((r) => r.class_category_id === ids.classB && r.income_category_id === ids.bus && r.period_name === "February")).toBe(true);
  });
});

describe("accepting", () => {
  it("moves the fee to Balances, owed in full, and out of the suggestions", async () => {
    const learner = await enrol("A");
    const [january] = await pending({ learner_id: learner.learnerId, income_category_id: ids.tuition, payment_period_id: ids.January });
    const result = await decide({ action: "ACCEPT", items: [keyOf(january)] });
    expect(result).toEqual({ changed: 1, unchanged: 0, amount: 100 });

    expect(await pending({ learner_id: learner.learnerId, income_category_id: ids.tuition, payment_period_id: ids.January })).toHaveLength(0);
    expect(await owed(learner.learnerId)).toEqual([{ fee: "Tuition", period: "January", charged: 100, paid: 0, balance: 100 }]);

    const accepted = await getExpectedFees(SCHOOL, { decision: "ACCEPTED", learner_id: learner.learnerId }, TODAY);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ decision: "ACCEPTED", source: "DECISION", decided_by: "Ada Admin", can_undo: true });
  });

  it("fixes the amount when accepted: a later change to the fee does not rewrite the balance, and payments are limited by it", async () => {
    const learner = await enrol("A");
    const [row] = await pending({ learner_id: learner.learnerId, income_category_id: ids.lab });
    await decide({ action: "ACCEPT", items: [keyOf(row)] });

    await query(`UPDATE income_categories SET income_limit = 45 WHERE income_category_id = $1`, [ids.lab]);
    try {
      expect((await owed(learner.learnerId))[0]).toMatchObject({ fee: "Lab", charged: 30, balance: 30 });
      // 31 would exceed what was accepted (30), even though the fee is now 45.
      await expect(pay(learner, ids.lab, ids.March, 31)).rejects.toThrow(/exceeds the remaining/);
      await pay(learner, ids.lab, ids.March, 30);
      expect((await owed(learner.learnerId))[0]).toMatchObject({ paid: 30, balance: 0 });
    } finally {
      await query(`UPDATE income_categories SET income_limit = 30 WHERE income_category_id = $1`, [ids.lab]);
    }
  });

  it("leaves alone anything no longer pending, instead of failing the batch", async () => {
    const learner = await enrol("A");
    const rows = await pending({ learner_id: learner.learnerId, income_category_id: ids.tuition });
    await decide({ action: "ACCEPT", items: [keyOf(rows[0])] });
    const again = await decide({ action: "ACCEPT", items: rows.map(keyOf) });
    expect(again.changed).toBe(rows.length - 1);
    expect(again.unchanged).toBe(1);
  });

  it("can be withdrawn while nothing is paid, and not after", async () => {
    const learner = await enrol("A");
    const [jan, feb] = await pending({ learner_id: learner.learnerId, income_category_id: ids.tuition });
    await decide({ action: "ACCEPT", items: [keyOf(jan), keyOf(feb)] });
    await pay(learner, ids.tuition, feb.payment_period_id!, 10);

    const result = await decide({ action: "UNDO_ACCEPT", items: [keyOf(jan), keyOf(feb)] });
    expect(result).toMatchObject({ changed: 1, unchanged: 1 });
    expect((await owed(learner.learnerId)).map((r) => r.period)).toEqual([feb.period_name]);
    // Withdrawn means pending again.
    expect((await pending({ learner_id: learner.learnerId, income_category_id: ids.tuition })).map((r) => r.period_name)).toContain(jan.period_name);
  });
});

describe("paying", () => {
  it("accepts the fee it pays for", async () => {
    const learner = await enrol("A");
    await pay(learner, ids.tuition, ids.February, 40);
    expect(await pending({ learner_id: learner.learnerId, income_category_id: ids.tuition, payment_period_id: ids.February })).toHaveLength(0);
    expect(await owed(learner.learnerId)).toEqual([{ fee: "Tuition", period: "February", charged: 100, paid: 40, balance: 60 }]);
    const [accepted] = await getExpectedFees(SCHOOL, { decision: "ACCEPTED", learner_id: learner.learnerId }, TODAY);
    expect(accepted).toMatchObject({ source: "PAYMENT", can_undo: false });
  });

  it("accepts a fee that was denied for that period, since it is being paid after all", async () => {
    const learner = await enrol("A");
    const [row] = await pending({ learner_id: learner.learnerId, income_category_id: ids.tuition, payment_period_id: ids.March });
    await decide({ action: "SKIP", items: [keyOf(row)] });
    await pay(learner, ids.tuition, ids.March, 100);
    expect(await getExpectedFees(SCHOOL, { decision: "SKIPPED", learner_id: learner.learnerId }, TODAY)).toHaveLength(0);
    expect(await owed(learner.learnerId)).toEqual([{ fee: "Tuition", period: "March", charged: 100, paid: 100, balance: 0 }]);
  });

  it("deleting the only payment undoes an acceptance the payment made, but not one someone made on purpose", async () => {
    const byPayment = await enrol("A");
    const charge = await pay(byPayment, ids.tuition, ids.January, 25);
    await deleteCharge(charge);
    expect(await owed(byPayment.learnerId)).toEqual([]);
    expect(await pending({ learner_id: byPayment.learnerId, income_category_id: ids.tuition, payment_period_id: ids.January })).toHaveLength(1);

    const onPurpose = await enrol("A");
    const [row] = await pending({ learner_id: onPurpose.learnerId, income_category_id: ids.tuition, payment_period_id: ids.January });
    await decide({ action: "ACCEPT", items: [keyOf(row)] });
    await deleteCharge(await pay(onPurpose, ids.tuition, ids.January, 25));
    expect(await owed(onPurpose.learnerId)).toEqual([{ fee: "Tuition", period: "January", charged: 100, paid: 0, balance: 100 }]);
  });
});

describe("denying", () => {
  it("for this period skips only that period, and can be brought back", async () => {
    const learner = await enrol("A");
    const [jan] = await pending({ learner_id: learner.learnerId, income_category_id: ids.tuition, payment_period_id: ids.January });
    expect(await decide({ action: "SKIP", items: [keyOf(jan)] })).toMatchObject({ changed: 1 });

    const left = await pending({ learner_id: learner.learnerId, income_category_id: ids.tuition });
    expect(left.map((r) => r.period_name)).not.toContain("January");
    expect(left.map((r) => r.period_name)).toContain("February");
    expect(await owed(learner.learnerId)).toEqual([]);

    const skipped = await getExpectedFees(SCHOOL, { decision: "SKIPPED", learner_id: learner.learnerId }, TODAY);
    expect(skipped.map((r) => r.period_name)).toEqual(["January"]);

    await decide({ action: "UNDO_SKIP", items: [keyOf(jan)] });
    expect((await pending({ learner_id: learner.learnerId, income_category_id: ids.tuition })).map((r) => r.period_name)).toContain("January");
  });

  it("forever removes every pending period of the fee for that learner, keeps what was accepted, and can be restored", async () => {
    const learner = await enrol("B");
    const [jan] = await pending({ learner_id: learner.learnerId, income_category_id: ids.bus, payment_period_id: ids.January });
    await decide({ action: "ACCEPT", items: [keyOf(jan)] });

    const result = await decide({ action: "EXEMPT", items: [{ learner_id: learner.learnerId, income_category_id: ids.bus }], reason: "Walks to school" });
    expect(result.changed).toBe(1);
    expect(await pending({ learner_id: learner.learnerId, income_category_id: ids.bus })).toHaveLength(0);
    // Not just started periods: April is never suggested either once it starts.
    expect(await getExpectedFees(SCHOOL, { learner_id: learner.learnerId, income_category_id: ids.bus }, "2026-12-01")).toHaveLength(0);
    expect(await owed(learner.learnerId)).toEqual([{ fee: "Bus", period: "January", charged: 50, paid: 0, balance: 50 }]);
    // Other fees are unaffected.
    expect(await pending({ learner_id: learner.learnerId, income_category_id: ids.tuition })).not.toHaveLength(0);

    const [exempt] = await getExpectedFees(SCHOOL, { decision: "EXEMPT", learner_id: learner.learnerId }, TODAY);
    expect(exempt).toMatchObject({ income_name: "Bus", reason: "Walks to school", payment_period_id: null, can_undo: true, class_name: "Class B" });

    await decide({ action: "RESTORE", items: [{ learner_id: learner.learnerId, income_category_id: ids.bus }] });
    expect((await pending({ learner_id: learner.learnerId, income_category_id: ids.bus })).length).toBeGreaterThan(0);
  });
});

describe("schools stay apart", () => {
  it("cannot accept, deny or exempt another school's learners or fees", async () => {
    const other = await enrol("A", OTHER_SCHOOL);
    const key = { learner_id: other.learnerId, income_category_id: otherSchoolFeeId, payment_period_id: ids.January, academic_year_id: ids.otherYear };
    expect(await decide({ action: "ACCEPT", items: [key] })).toMatchObject({ changed: 0, unchanged: 1 });
    expect(await decide({ action: "EXEMPT", items: [{ learner_id: other.learnerId, income_category_id: otherSchoolFeeId }], reason: "x" })).toMatchObject({ changed: 0 });
    // This school's fee for that school's learner is refused too.
    expect(await decide({ action: "EXEMPT", items: [{ learner_id: other.learnerId, income_category_id: ids.tuition }], reason: "x" })).toMatchObject({ changed: 0 });

    const mine = await getExpectedFees(SCHOOL, {}, TODAY);
    expect(mine.some((row) => row.learner_id === other.learnerId)).toBe(false);
  });
});

describe("the API", () => {
  const url = `http://localhost/api/schools/${SCHOOL}/expected-fees`;

  it("refuses anyone not signed in", async () => {
    expect((await GET_FEES(request(url), params({ school_id: SCHOOL }))).status).toBe(401);
    expect((await POST_DECISIONS(request(`${url}/decisions`, { method: "POST", body: "{}" }), params({ school_id: SCHOOL }))).status).toBe(401);
  });

  it("lists, decides and exports for a signed-in administrator", async () => {
    const learner = await enrol("A");
    const list = await GET_FEES(request(`${url}?learner_id=${learner.learnerId}&income_category_id=${ids.tuition}`, { token: adminToken }), params({ school_id: SCHOOL }));
    expect(list.status).toBe(200);
    const rows = (await list.json()) as ExpectedFeeRow[];
    expect(rows.length).toBeGreaterThan(0);

    const accept = await POST_DECISIONS(
      request(`${url}/decisions`, { method: "POST", token: adminToken, body: JSON.stringify({ action: "ACCEPT", items: [keyOf(rows[0])] }) }),
      params({ school_id: SCHOOL }),
    );
    expect(accept.status).toBe(200);
    expect(await accept.json()).toMatchObject({ changed: 1 });

    const audit = await query(`SELECT action, summary FROM audit_log WHERE action = 'expected_fee.accept' AND entity_id = $1`, [learner.learnerId]);
    expect(audit.rows).toHaveLength(1);

    const pdf = await GET_FEES(request(`${url}?format=pdf`, { token: adminToken }), params({ school_id: SCHOOL }));
    expect(pdf.status).toBe(200);
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF");
  });

  it("requires a reason to deny forever, and rejects bad input", async () => {
    const learner = await enrol("A");
    const post = (body: unknown) => POST_DECISIONS(
      request(`${url}/decisions`, { method: "POST", token: adminToken, body: JSON.stringify(body) }),
      params({ school_id: SCHOOL }),
    );
    const noReason = await post({ action: "EXEMPT", items: [{ learner_id: learner.learnerId, income_category_id: ids.tuition }], reason: "  " });
    expect(noReason.status).toBe(400);
    expect((await post({ action: "ACCEPT", items: [] })).status).toBe(400);
    expect((await post({ action: "ACCEPT", items: [{ learner_id: learner.learnerId }] })).status).toBe(400);
    expect((await post({ action: "DELETE_EVERYTHING", items: [{}] })).status).toBe(400);
    expect((await GET_FEES(request(`${url}?decision=MAYBE`, { token: adminToken }), params({ school_id: SCHOOL }))).status).toBe(400);
  });
});
