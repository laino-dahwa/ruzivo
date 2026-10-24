import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { POST } from "../app/api/learners/payments/route";
import { createSchool } from "../repositories/school/create/createSchool";
import { createGender } from "../repositories/school/create/createGenderCategory";
import { createClassCategory } from "../repositories/school/create/createClassCategory";
import { createAcademicYear } from "../repositories/school/create/createAcademicYear";
import { createIncomeCategory } from "../repositories/school/create/createIncomeCategory";
import { createPaymentPeriod } from "../repositories/school/create/createPaymentPeriod";
import { createPaymentMethod } from "../repositories/school/create/createPaymentMethod";
import { createLearners } from "../repositories/learner/create/addLearner";
import { getLearners } from "../repositories/learner/read/getLearners";
import { getBalances } from "../repositories/payment/read/getBalances";
import { deleteLearner } from "../repositories/learner/delete/deleteLearner";
import { getPool, query } from "../lib/db";

// A learner owes `income_limit` for one fee, in one period, of one academic
// year. These tests drive the real API route so the limit is enforced exactly
// where a manual/API caller would hit it, not just at the repository.
const SCHOOL = "PLM";
const LIMIT = 100;

let learnerId: string;
let otherLearnerId: string;
let archivedLearnerId: string;
let enrolmentId: number;
let otherEnrolmentId: number;
let archivedEnrolmentId: number;
let tuitionId: number;      // limit 100
let transportId: number;    // limit 100, a second fee in the same period
let unlimitedId: number;    // no limit configured
let januaryId: number;
let februaryId: number;
let yearId: number;
let methodId: number;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/learners/payments", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function payment(amount: number, options: { period?: number; income?: number; learner?: string; enrolment?: number } = {}) {
  return {
    learner_id: options.learner ?? learnerId,
    enrolment_id: options.enrolment ?? enrolmentId,
    payment_period_id: options.period ?? januaryId,
    academic_year_id: yearId,
    payment_method_id: methodId,
    income_categories: [{ income_category_id: options.income ?? tuitionId, amount }],
  };
}

async function post(body: unknown) {
  const response = await POST(makeRequest(body));
  return { status: response.status, body: await response.json() };
}

/** Total actually stored for a learner against one fee in one period. */
async function totalPaid(options: { learner?: string; income?: number; period?: number } = {}): Promise<number> {
  const result = await query(
    `SELECT COALESCE(SUM(p.amount), 0) AS paid
     FROM charges c
     JOIN payment_allocations pa ON pa.charge_id = c.charge_id
     JOIN payments p ON p.payment_id = pa.payment_id
     WHERE c.learner_id = $1 AND c.income_category_id = $2 AND c.payment_period_id = $3`,
    [options.learner ?? learnerId, options.income ?? tuitionId, options.period ?? januaryId]
  );
  return Number(result.rows[0].paid);
}

beforeAll(async () => {
  await createSchool([{ school_id: SCHOOL, school_name: "Limit Test", school_type: "primary", school_address: "n/a", school_contact: "n/a", school_email: "limit@test.local" }]);
  const [gender] = await createGender([{ school_id: SCHOOL, gender_name: "Male" }]);
  const [classCategory] = await createClassCategory([{ school_id: SCHOOL, class_name: "Grade 1" }]);
  const [year] = await createAcademicYear([{ school_id: SCHOOL, academic_year_name: "2026", start_date: "2026-01-01", end_date: "2026-12-31" }]);
  const [tuition] = await createIncomeCategory([{ school_id: SCHOOL, income_name: "Tuition", income_limit: String(LIMIT) }]);
  const [transport] = await createIncomeCategory([{ school_id: SCHOOL, income_name: "Transport", income_limit: String(LIMIT) }]);
  const [unlimited] = await createIncomeCategory([{ school_id: SCHOOL, income_name: "Donations", income_limit: null as unknown as string }]);
  const [january] = await createPaymentPeriod([{ school_id: SCHOOL, period_name: "January" }]);
  const [february] = await createPaymentPeriod([{ school_id: SCHOOL, period_name: "February" }]);
  const [method] = await createPaymentMethod([{ school_id: SCHOOL, method_name: "Cash" }]);

  yearId = year.academic_year_id;
  tuitionId = tuition.income_category_id;
  transportId = transport.income_category_id;
  unlimitedId = unlimited.income_category_id;
  januaryId = january.payment_period_id;
  februaryId = february.payment_period_id;
  methodId = method.payment_method_id;

  const created = await createLearners([
    { school_id: SCHOOL, first_name: "John", last_name: "Limit", gender_id: gender.gender_id, date_of_birth: "2015-01-01", class_category_id: classCategory.class_category_id, academic_year_id: yearId },
    { school_id: SCHOOL, first_name: "Mary", last_name: "Limit", gender_id: gender.gender_id, date_of_birth: "2015-02-01", class_category_id: classCategory.class_category_id, academic_year_id: yearId },
    { school_id: SCHOOL, first_name: "Ada", last_name: "Archived", gender_id: gender.gender_id, date_of_birth: "2015-03-01", class_category_id: classCategory.class_category_id, academic_year_id: yearId },
  ]);
  learnerId = created[0].learner_id;
  otherLearnerId = created[1].learner_id;
  archivedLearnerId = created[2].learner_id;
  enrolmentId = (await getLearners(learnerId, null, null, null))[0].enrolment_id;
  otherEnrolmentId = (await getLearners(otherLearnerId, null, null, null))[0].enrolment_id;
  archivedEnrolmentId = (await getLearners(archivedLearnerId, null, null, null))[0].enrolment_id;
  await deleteLearner(archivedLearnerId);
});

// Removes everything this suite created, so it can be re-run against a
// persistent database — the same convention the other suites follow. Deleted
// in FK order: the learner tables first, then the school, whose reference data
// (fees, periods, methods, …) cascades with it.
afterAll(async () => {
  const learners = [learnerId, otherLearnerId, archivedLearnerId];
  await query(`DELETE FROM payment_allocations WHERE charge_id IN (SELECT charge_id FROM charges WHERE learner_id = ANY($1::text[]))`, [learners]);
  await query(`DELETE FROM payments WHERE payment_id NOT IN (SELECT payment_id FROM payment_allocations)`);
  await query(`DELETE FROM charges WHERE learner_id = ANY($1::text[])`, [learners]);
  await query(`DELETE FROM enrolments WHERE learner_id = ANY($1::text[])`, [learners]);
  await query(`DELETE FROM learners WHERE school_id = $1`, [SCHOOL]);
  await query(`DELETE FROM schools WHERE school_id = $1`, [SCHOOL]);
});

// Each test starts from a clean payment history so the scenarios are exact.
afterEach(async () => {
  await query(`DELETE FROM payment_allocations WHERE charge_id IN (SELECT charge_id FROM charges WHERE learner_id = ANY($1::text[]))`, [[learnerId, otherLearnerId]]);
  await query(`DELETE FROM payments WHERE payment_id NOT IN (SELECT payment_id FROM payment_allocations)`);
  await query(`DELETE FROM charges WHERE learner_id = ANY($1::text[])`, [[learnerId, otherLearnerId]]);
});

describe("single payments against the period limit", () => {
  it("TEST 1: paid 0, pays the full 100 — accepted, remaining 0", async () => {
    const { status } = await post(payment(100));
    expect(status).toBe(201);
    expect(await totalPaid()).toBe(100);
  });

  it("TEST 2: paid 0, tries 101 — rejected, nothing stored", async () => {
    const { status, body } = await post(payment(101));
    expect(status).toBe(400);
    expect(body.error).toContain("remaining");
    expect(await totalPaid()).toBe(0);
  });

  it("TEST 3: paid 10, pays 90 — accepted, total exactly 100", async () => {
    await post(payment(10));
    const { status } = await post(payment(90));
    expect(status).toBe(201);
    expect(await totalPaid()).toBe(100);
  });

  it("TEST 4: paid 10, tries 91 — rejected", async () => {
    await post(payment(10));
    const { status } = await post(payment(91));
    expect(status).toBe(400);
    expect(await totalPaid()).toBe(10);
  });

  it("TEST 5: fully paid, tries 1 more — rejected with an 'already paid' message", async () => {
    await post(payment(100));
    const { status, body } = await post(payment(1));
    expect(status).toBe(400);
    expect(body.error).toContain("already paid the full");
    expect(body.error).toContain("January");
    expect(await totalPaid()).toBe(100);
  });

  it("TEST 6 & 7: paid 60 — accepts exactly 40, rejects 41", async () => {
    await post(payment(60));

    const rejected = await post(payment(41));
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toContain("$40.00");
    expect(await totalPaid()).toBe(60);

    const accepted = await post(payment(40));
    expect(accepted.status).toBe(201);
    expect(await totalPaid()).toBe(100);
  });

  it("TEST 8 & 9: after 20 + 30 + 40, accepts 10 but rejects 11", async () => {
    await post(payment(20));
    await post(payment(30));
    await post(payment(40));
    expect(await totalPaid()).toBe(90);

    expect((await post(payment(11))).status).toBe(400);
    expect(await totalPaid()).toBe(90);

    expect((await post(payment(10))).status).toBe(201);
    expect(await totalPaid()).toBe(100);
  });

  it("SCENARIO 6: many small payments run down the balance and then stop", async () => {
    for (const amount of [10, 20, 30, 40]) {
      expect((await post(payment(amount))).status).toBe(201);
    }
    expect(await totalPaid()).toBe(100);

    expect((await post(payment(1))).status).toBe(400);
    expect(await totalPaid()).toBe(100);
  });
});

describe("bulk payments in a single request", () => {
  it("TEST 10: paid 80, bulk of 10 + 10 lands exactly on the limit", async () => {
    await post(payment(80));
    const { status } = await post([payment(10), payment(10)]);
    expect(status).toBe(201);
    expect(await totalPaid()).toBe(100);
  });

  it("TEST 11: paid 80, bulk of 10 + 15 would reach 105 — whole request rejected", async () => {
    await post(payment(80));
    const { status, body } = await post([payment(10), payment(15)]);
    expect(status).toBe(400);
    // The second line is the one that breaches the limit.
    expect(body.details[0].index).toBe(1);
    // Nothing at all is written — the batch is atomic.
    expect(await totalPaid()).toBe(80);
  });

  it("rejects a bulk request whose lines only exceed the limit together", async () => {
    // 60 + 60 = 120: each line alone would pass, together they must not.
    const { status } = await post([payment(60), payment(60)]);
    expect(status).toBe(400);
    expect(await totalPaid()).toBe(0);
  });

  it("applies the same accumulation to several lines for one learner in one record", async () => {
    await post(payment(80));
    const { status, body } = await post({
      learner_id: learnerId,
      enrolment_id: enrolmentId,
      payment_period_id: januaryId,
      academic_year_id: yearId,
      payment_method_id: methodId,
      income_categories: [
        { income_category_id: tuitionId, amount: 10 },
        { income_category_id: tuitionId, amount: 15 },
      ],
    });
    expect(status).toBe(400);
    expect(body.error).toContain("remaining");
    expect(await totalPaid()).toBe(80);
  });

  it("returns one created entry per line, in the order the lines were submitted", async () => {
    const { status, body } = await post([
      payment(10, { income: tuitionId }),
      payment(20, { income: transportId }),
      payment(30, { income: unlimitedId, learner: otherLearnerId, enrolment: otherEnrolmentId }),
    ]);
    expect(status).toBe(201);
    expect(body.map((entry: { charge: { income_category_id: string } }) => String(entry.charge.income_category_id)))
      .toEqual([tuitionId, transportId, unlimitedId].map(String));
    expect(body.map((entry: { payment: { amount: string } }) => Number(entry.payment.amount))).toEqual([10, 20, 30]);
    expect(body[2].charge.learner_id).toBe(otherLearnerId);
    for (const entry of body) {
      expect(entry.allocation.charge_id).toBe(entry.charge.charge_id);
      expect(entry.allocation.payment_id).toBe(entry.payment.payment_id);
    }
  });

  it("a payment waits for a concurrent one on the same fee, then counts it", async () => {
    // Stands in for another request that is mid-transaction: it holds the
    // same advisory lock the repository takes (same key format) and has
    // written 60 without committing. Without the lock, the API call below
    // would read 0 paid and accept another 60; with it, the call waits, then
    // sees the committed 60 and refuses.
    const pool = await getPool();
    const other = await pool.connect();
    try {
      await other.query("BEGIN");
      await other.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${learnerId}|${tuitionId}|${januaryId}|${yearId}`]);
      const { rows: [charge] } = await other.query(
        `INSERT INTO charges (learner_id, enrolment_id, income_category_id, payment_period_id, academic_year_id) VALUES ($1, $2, $3, $4, $5) RETURNING charge_id`,
        [learnerId, enrolmentId, tuitionId, januaryId, yearId]
      );
      const { rows: [paid] } = await other.query(`INSERT INTO payments (amount, payment_method_id) VALUES (60, $1) RETURNING payment_id`, [methodId]);
      await other.query(`INSERT INTO payment_allocations (payment_id, charge_id) VALUES ($1, $2)`, [paid.payment_id, charge.charge_id]);

      const racing = post(payment(60));
      await new Promise((resolve) => setTimeout(resolve, 300));
      await other.query("COMMIT");

      const { status, body } = await racing;
      expect(status).toBe(400);
      expect(body.error).toContain("$40.00 remaining");
    } finally {
      other.release();
    }
    expect(await totalPaid()).toBe(60);
  });

  it("does not block unrelated learners in the same bulk request", async () => {
    await post(payment(100));
    const { status } = await post([
      payment(50, { learner: otherLearnerId, enrolment: otherEnrolmentId }),
    ]);
    expect(status).toBe(201);
    expect(await totalPaid({ learner: otherLearnerId })).toBe(50);
  });
});

describe("limits are scoped to learner, fee and period", () => {
  it("TEST 12: a fully-paid January does not block February", async () => {
    await post(payment(100));
    expect((await post(payment(10))).status).toBe(400);

    const february = await post(payment(50, { period: februaryId }));
    expect(february.status).toBe(201);
    expect(await totalPaid({ period: februaryId })).toBe(50);
  });

  it("a fully-paid fee does not block a different fee in the same period", async () => {
    await post(payment(100));
    const transport = await post(payment(75, { income: transportId }));
    expect(transport.status).toBe(201);
    expect(await totalPaid({ income: transportId })).toBe(75);
  });

  it("one learner's full payment does not affect another learner", async () => {
    await post(payment(100));
    const other = await post(payment(100, { learner: otherLearnerId, enrolment: otherEnrolmentId }));
    expect(other.status).toBe(201);
    expect(await totalPaid({ learner: otherLearnerId })).toBe(100);
  });

  it("a fee with no configured limit is not restricted", async () => {
    const first = await post(payment(5000, { income: unlimitedId }));
    expect(first.status).toBe(201);
    const second = await post(payment(5000, { income: unlimitedId }));
    expect(second.status).toBe(201);
    expect(await totalPaid({ income: unlimitedId })).toBe(10000);
  });
});

describe("deleting a payment frees up the balance again", () => {
  it("allows paying the freed amount after a charge is deleted", async () => {
    await post(payment(60));
    const { body } = await post(payment(40));
    expect(await totalPaid()).toBe(100);

    // Reversing the 40 must make exactly 40 payable again.
    const chargeId = body[0].charge.charge_id;
    const { deleteCharge } = await import("../repositories/payment/delete/delete_payment");
    await deleteCharge(Number(chargeId));
    expect(await totalPaid()).toBe(60);

    expect((await post(payment(41))).status).toBe(400);
    expect((await post(payment(40))).status).toBe(201);
    expect(await totalPaid()).toBe(100);
  });
});

describe("archived (soft-deleted) learners cannot receive new charges or payments", () => {
  it("rejects a payment for an archived learner and stores nothing", async () => {
    const { status, body } = await post(payment(50, { learner: archivedLearnerId, enrolment: archivedEnrolmentId }));
    expect(status).toBe(400);
    expect(body.error).toContain("archived learner");
    expect(await totalPaid({ learner: archivedLearnerId })).toBe(0);
  });

  it("rejects the whole bulk request if any line targets an archived learner", async () => {
    const { status } = await post([
      payment(10),
      payment(50, { learner: archivedLearnerId, enrolment: archivedEnrolmentId }),
    ]);
    expect(status).toBe(400);
    expect(await totalPaid()).toBe(0);
  });
});

describe("balances stay consistent with the enforced limit", () => {
  it("never lets the reported balance go negative", async () => {
    await post(payment(60));
    await post(payment(40));
    await post(payment(25)); // rejected

    const balance = (await getBalances(SCHOOL, learnerId, null, null, null, "Tuition", "January"))[0];
    expect(Number(balance.charged)).toBe(LIMIT);
    expect(Number(balance.paid)).toBe(100);
    expect(Number(balance.balance)).toBe(0);
  });
});

describe("once-off income categories", () => {
  let registrationId: number; // ONCE_OFF for January only, limit 100
  let examLevyId: number;     // ONCE_OFF for January and February, no limit

  beforeAll(async () => {
    const [registration] = await createIncomeCategory([{
      school_id: SCHOOL,
      income_name: "Registration",
      income_limit: "100",
      priority: "ONCE_OFF",
      // Periods sent on purpose: a once-off fee ignores them (any period will do).
      period_applicability: "ALL_PERIODS",
      payment_period_ids: [Number(januaryId)],
    }]);
    const [examLevy] = await createIncomeCategory([{
      school_id: SCHOOL,
      income_name: "Exam Levy",
      income_limit: null,
      priority: "ONCE_OFF",
      payment_period_ids: [Number(januaryId), Number(februaryId)],
    }]);
    registrationId = Number(registration.income_category_id);
    examLevyId = Number(examLevy.income_category_id);
  });

  it("is stored with no periods, whatever periods were sent", async () => {
    const row = await query(`SELECT priority, class_applicability, period_applicability FROM income_categories WHERE income_category_id = $1`, [registrationId]);
    expect(row.rows[0]).toEqual({ priority: "ONCE_OFF", class_applicability: "ALL_LEARNERS", period_applicability: "ALL_PERIODS" });
    const periods = await query(`SELECT 1 FROM income_category_periods WHERE income_category_id = $1`, [registrationId]);
    expect(periods.rowCount).toBe(0);
  });

  it("can be created without choosing a period", async () => {
    const { POST: POST_INCOME } = await import("../app/api/schools/[school_id]/income_categories/route");
    const response = await POST_INCOME(new Request(`http://localhost/api/schools/${SCHOOL}/income_categories`, {
      method: "POST",
      body: JSON.stringify([{ school_id: SCHOOL, income_name: "No Period Fee", income_limit: "10", priority: "ONCE_OFF", payment_period_ids: [] }]),
    }));
    expect(response.status).toBe(201);
  });

  it("can be paid in any period, with the limit applying to the period it is paid in", async () => {
    expect((await post(payment(60, { income: registrationId, period: januaryId }))).status).toBe(201);
    expect((await post(payment(40, { income: registrationId, period: januaryId }))).status).toBe(201);
    const again = await post(payment(1, { income: registrationId, period: januaryId }));
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/already paid the full Registration amount of \$100\.00 for January/);

    // February is its own period with its own limit.
    expect((await post(payment(100, { income: registrationId, period: februaryId }))).status).toBe(201);
    expect(await totalPaid({ income: registrationId, period: februaryId })).toBe(100);
  });

  it("a part payment leaves the rest owing for that period only", async () => {
    expect((await post(payment(30, { income: registrationId, period: januaryId }))).status).toBe(201);
    const tooMuch = await post(payment(71, { income: registrationId, period: januaryId }));
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error).toMatch(/remaining Registration balance for January\. The learner has \$70\.00 remaining/);
    // What was paid in January does not reduce February.
    expect((await post(payment(71, { income: registrationId, period: februaryId }))).status).toBe(201);
  });

  it("with no limit set, is paid one time per period, in any period", async () => {
    expect((await post(payment(25, { income: examLevyId, period: januaryId }))).status).toBe(201);
    const secondJanuary = await post(payment(5, { income: examLevyId, period: januaryId }));
    expect(secondJanuary.status).toBe(400);
    expect(secondJanuary.body.error).toMatch(/once-off payment and the learner has already paid it for January/);
    expect((await post(payment(25, { income: examLevyId, period: februaryId }))).status).toBe(201);

    // Two lines for the same period in one request: the second is refused.
    const bothAtOnce = await post([
      payment(10, { income: examLevyId, learner: otherLearnerId, enrolment: otherEnrolmentId }),
      payment(10, { income: examLevyId, learner: otherLearnerId, enrolment: otherEnrolmentId }),
    ]);
    expect(bothAtOnce.status).toBe(400);
  });

  it("shows on the balance screens once per period it was paid in", async () => {
    await post(payment(30, { income: registrationId, period: januaryId }));
    await post(payment(20, { income: registrationId, period: februaryId }));
    const rows = await getBalances(SCHOOL, learnerId, null, null, null, "Registration", null);
    const byPeriod = Object.fromEntries(rows.map((r) => [r.period_name, { paid: Number(r.paid), balance: Number(r.balance) }]));
    expect(byPeriod).toEqual({ January: { paid: 30, balance: 70 }, February: { paid: 20, balance: 80 } });
  });

  it("is not listed as owed until paid, then shows the rest owing in that period only", async () => {
    const { getObligations } = await import("../repositories/payment/read/getObligations");
    const filters = {
      class_category_id: null, learner_id: learnerId, income_category_id: registrationId,
      priority: null, status: null, academic_year_id: null, payment_period_id: null,
    };
    expect(await getObligations(SCHOOL, filters)).toHaveLength(0);

    await post(payment(5, { income: registrationId, period: januaryId }));
    let rows = await getObligations(SCHOOL, filters);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ priority: "ONCE_OFF", period_name: "January", status: "PARTIALLY_PAID" });
    expect(Number(rows[0].balance)).toBe(95);

    // Paying it again in February adds February's own row; nothing is
    // projected into periods it was never paid in.
    await post(payment(10, { income: registrationId, period: februaryId }));
    rows = await getObligations(SCHOOL, filters);
    expect(rows.map((r) => [r.period_name, Number(r.balance)]).sort()).toEqual([["February", 90], ["January", 95]]);
  });

  it("with no limit set, is never listed as owed, even once paid", async () => {
    const { getObligations } = await import("../repositories/payment/read/getObligations");
    await post(payment(25, { income: examLevyId, period: januaryId }));
    const rows = await getObligations(SCHOOL, {
      class_category_id: null, learner_id: learnerId, income_category_id: examLevyId,
      priority: null, status: null, academic_year_id: null, payment_period_id: null,
    });
    expect(rows).toHaveLength(0);
  });
});

