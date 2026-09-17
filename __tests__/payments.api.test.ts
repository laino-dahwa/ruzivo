import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET, POST, DELETE } from "../app/api/learners/payments/route";
import { createSchool } from "../repositories/school/create/createSchool";
import { createGender } from "../repositories/school/create/createGenderCategory";
import { createClassCategory } from "../repositories/school/create/createClassCategory";
import { createAcademicYear } from "../repositories/school/create/createAcademicYear";
import { createIncomeCategory } from "../repositories/school/create/createIncomeCategory";
import { createPaymentPeriod } from "../repositories/school/create/createPaymentPeriod";
import { createPaymentMethod } from "../repositories/school/create/createPaymentMethod";
import { createLearners } from "../repositories/learner/create/addLearner";
import { GET as GET_LEARNERS, DELETE as DELETE_LEARNER } from "../app/api/learners/route";
import { GET as GET_BALANCES } from "../app/api/learners/balances/route";
import { query } from "../lib/db";

// Dedicated, disposable test school + reference data so this suite never
// touches real data in the shared dev database. Everything created here is
// removed in afterAll. School id kept to 3 characters — see
// __tests__/learners.api.test.ts for why a 4-character id would break
// learner creation (a real, pre-existing, unfixed bug).
const SCHOOL = "TPA";

let genderId: number;
let classId: number;
let yearId: number;
let incomeCategoryId: number;
let paymentPeriodId: number;
let paymentMethodId: number;
let learnerId: string;
let enrolmentId: number;

function makeRequest(url: string, init?: RequestInit) {
  return new Request(url, init);
}

async function readJson(response: Response) {
  return response.json();
}

beforeAll(async () => {
  await createSchool([{ school_id: SCHOOL, school_name: "Test Payment School", school_type: "primary", school_address: "n/a", school_contact: "n/a", school_email: "pay@test.local" }]);

  const [gender] = await createGender([{ school_id: SCHOOL, gender_name: "Test Gender P" }]);
  const [classCategory] = await createClassCategory([{ school_id: SCHOOL, class_name: "Test Class P" }]);
  const [academicYear] = await createAcademicYear([{ school_id: SCHOOL, academic_year_name: "Test Year P", start_date: "2026-01-01", end_date: "2026-12-31" }]);
  // Deliberately generous: this suite exercises payment CRUD and bulk
  // mechanics, and its cases accumulate well past a realistic term fee. The
  // per-period limit enforcement itself is covered in payment-limits.test.ts,
  // so the limit here only needs to stay out of the way.
  const [incomeCategory] = await createIncomeCategory([{ school_id: SCHOOL, income_name: "Test Fee", income_limit: "1000000" }]);
  const [paymentPeriod] = await createPaymentPeriod([{ school_id: SCHOOL, period_name: "Test Term" }]);
  const [paymentMethod] = await createPaymentMethod([{ school_id: SCHOOL, method_name: "Test Cash" }]);

  genderId = gender.gender_id;
  classId = classCategory.class_category_id;
  yearId = academicYear.academic_year_id;
  incomeCategoryId = incomeCategory.income_category_id;
  paymentPeriodId = paymentPeriod.payment_period_id;
  paymentMethodId = paymentMethod.payment_method_id;

  const [learner] = await createLearners([{
    school_id: SCHOOL,
    first_name: "Pay",
    last_name: "Er",
    gender_id: genderId,
    date_of_birth: "2015-01-01",
    class_category_id: classId,
    academic_year_id: yearId,
  }]);
  learnerId = learner.learner_id;

  const enrolmentRow = await query("SELECT enrolment_id FROM enrolments WHERE learner_id = $1", [learnerId]);
  enrolmentId = Number(enrolmentRow.rows[0].enrolment_id);
});

afterAll(async () => {
  await query("DELETE FROM payment_allocations WHERE charge_id IN (SELECT charge_id FROM charges WHERE learner_id = $1)", [learnerId]);
  await query("DELETE FROM payments WHERE payment_id NOT IN (SELECT payment_id FROM payment_allocations)");
  await query("DELETE FROM charges WHERE learner_id = $1", [learnerId]);
  await query("DELETE FROM enrolments WHERE learner_id = $1", [learnerId]);
  await query("DELETE FROM learners WHERE learner_id = $1", [learnerId]);
  await query("DELETE FROM payment_methods WHERE payment_method_id = $1", [paymentMethodId]);
  await query("DELETE FROM payment_periods WHERE payment_period_id = $1", [paymentPeriodId]);
  await query("DELETE FROM income_categories WHERE income_category_id = $1", [incomeCategoryId]);
  await query("DELETE FROM academic_years WHERE academic_year_id = $1", [yearId]);
  await query("DELETE FROM class_categories WHERE class_category_id = $1", [classId]);
  await query("DELETE FROM genders WHERE gender_id = $1", [genderId]);
  await query("DELETE FROM schools WHERE school_id = $1", [SCHOOL]);
});

function makePaymentInput(amount: number) {
  return {
    learner_id: learnerId,
    enrolment_id: enrolmentId,
    payment_period_id: paymentPeriodId,
    academic_year_id: yearId,
    payment_method_id: paymentMethodId,
    income_categories: [{ income_category_id: incomeCategoryId, amount }],
  };
}

describe("POST /api/learners/payments (record a payment)", () => {
  it("creates a charge + payment + allocation and persists them in Postgres with matching values", async () => {
    const response = await POST(makeRequest("http://localhost/api/learners/payments", {
      method: "POST",
      body: JSON.stringify(makePaymentInput(120)),
    }));
    expect(response.status).toBe(201);

    const body = await readJson(response);
    expect(body).toHaveLength(1);
    const { charge, payment, allocation } = body[0];
    expect(charge.learner_id).toBe(learnerId);
    expect(Number(payment.amount)).toBe(120);
    expect(allocation.charge_id).toBe(charge.charge_id);
    expect(allocation.payment_id).toBe(payment.payment_id);

    const dbCharge = await query("SELECT learner_id, income_category_id FROM charges WHERE charge_id = $1", [charge.charge_id]);
    expect(dbCharge.rowCount).toBe(1);
    expect(dbCharge.rows[0]).toMatchObject({ learner_id: learnerId, income_category_id: String(incomeCategoryId) });

    const dbPayment = await query("SELECT amount, payment_method_id FROM payments WHERE payment_id = $1", [payment.payment_id]);
    expect(Number(dbPayment.rows[0].amount)).toBe(120);
    expect(dbPayment.rows[0].payment_method_id).toBe(String(paymentMethodId));
  });

  it("records several payments for the SAME learner in one request", async () => {
    // One learner paying towards several fees: one input object whose
    // income_categories array carries a line per fee.
    const response = await POST(makeRequest("http://localhost/api/learners/payments", {
      method: "POST",
      body: JSON.stringify({
        learner_id: learnerId,
        enrolment_id: enrolmentId,
        payment_period_id: paymentPeriodId,
        academic_year_id: yearId,
        payment_method_id: paymentMethodId,
        income_categories: [
          { income_category_id: incomeCategoryId, amount: 40 },
          { income_category_id: incomeCategoryId, amount: 60 },
          { income_category_id: incomeCategoryId, amount: 80 },
        ],
      }),
    }));
    expect(response.status).toBe(201);

    const body = await readJson(response);
    expect(body).toHaveLength(3);

    // Every line is its own charge + payment + allocation, all for one learner.
    expect(body.every((entry: { charge: { learner_id: string } }) => entry.charge.learner_id === learnerId)).toBe(true);
    const chargeIds = body.map((entry: { charge: { charge_id: number } }) => entry.charge.charge_id);
    expect(new Set(chargeIds).size).toBe(3);

    const amounts = body.map((entry: { payment: { amount: string } }) => Number(entry.payment.amount)).sort((a: number, b: number) => a - b);
    expect(amounts).toEqual([40, 60, 80]);

    const allocations = await query("SELECT charge_id FROM payment_allocations WHERE charge_id = ANY($1::bigint[])", [chargeIds]);
    expect(allocations.rowCount).toBe(3);
  });

  it("records payments for several learners, each with several lines, in one request", async () => {
    const before = await query("SELECT count(*)::int FROM charges WHERE learner_id = $1", [learnerId]);

    const response = await POST(makeRequest("http://localhost/api/learners/payments", {
      method: "POST",
      body: JSON.stringify([
        { ...makePaymentInput(10), income_categories: [
          { income_category_id: incomeCategoryId, amount: 10 },
          { income_category_id: incomeCategoryId, amount: 15 },
        ] },
        { ...makePaymentInput(20), income_categories: [
          { income_category_id: incomeCategoryId, amount: 20 },
        ] },
      ]),
    }));
    expect(response.status).toBe(201);

    // 2 learners' worth of input, 3 payment records in total.
    const body = await readJson(response);
    expect(body).toHaveLength(3);

    const after = await query("SELECT count(*)::int FROM charges WHERE learner_id = $1", [learnerId]);
    expect(after.rows[0].count).toBe(before.rows[0].count + 3);
  });

  it("names the failing line when one learner has several payment lines", async () => {
    const response = await POST(makeRequest("http://localhost/api/learners/payments", {
      method: "POST",
      body: JSON.stringify({
        ...makePaymentInput(10),
        income_categories: [
          { income_category_id: incomeCategoryId, amount: 10 },
          { income_category_id: incomeCategoryId, amount: 0 },
        ],
      }),
    }));
    expect(response.status).toBe(400);

    const body = await readJson(response);
    expect(body.details).toEqual([
      { index: 0, field: "amount", message: "Payment line 2: Amount must be greater than zero" },
    ]);
  });

  it("records several payments from one array in a single request", async () => {
    const response = await POST(makeRequest("http://localhost/api/learners/payments", {
      method: "POST",
      body: JSON.stringify([makePaymentInput(10), makePaymentInput(20), makePaymentInput(30)]),
    }));
    expect(response.status).toBe(201);

    const body = await readJson(response);
    expect(body).toHaveLength(3);

    const amounts = body.map((entry: { payment: { amount: string } }) => Number(entry.payment.amount)).sort((a: number, b: number) => a - b);
    expect(amounts).toEqual([10, 20, 30]);

    // Each payment must have its own charge and allocation.
    const chargeIds = body.map((entry: { charge: { charge_id: number } }) => entry.charge.charge_id);
    expect(new Set(chargeIds).size).toBe(3);

    const allocations = await query("SELECT charge_id FROM payment_allocations WHERE charge_id = ANY($1::bigint[])", [chargeIds]);
    expect(allocations.rowCount).toBe(3);
  });

  it("rejects the whole batch when one payment is invalid, and persists none of it", async () => {
    const before = await query("SELECT count(*)::int FROM charges WHERE learner_id = $1", [learnerId]);

    const response = await POST(makeRequest("http://localhost/api/learners/payments", {
      method: "POST",
      body: JSON.stringify([makePaymentInput(50), makePaymentInput(-5)]),
    }));
    expect(response.status).toBe(400);

    const body = await readJson(response);
    expect(body.details).toEqual([{ index: 1, field: "amount", message: "Amount must be greater than zero" }]);
    expect(body.error).toContain("Payment 2");

    // Nothing from the valid record survives either — the batch is atomic.
    const after = await query("SELECT count(*)::int FROM charges WHERE learner_id = $1", [learnerId]);
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it("exports the payments table as a valid PDF", async () => {
    const response = await GET(makeRequest("http://localhost/api/learners/payments?format=pdf"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toContain("payments-");

    const buffer = Buffer.from(await response.arrayBuffer());
    expect(buffer.subarray(0, 4).toString("ascii")).toBe("%PDF");
    expect(buffer.length).toBeGreaterThan(500);
  });

  it("exports the outstanding balances table as a valid PDF", async () => {
    const response = await GET_BALANCES(makeRequest(`http://localhost/api/learners/balances?school_id=${SCHOOL}&format=pdf`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toContain("outstanding-balances-");

    const buffer = Buffer.from(await response.arrayBuffer());
    expect(buffer.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });

  it("rejects a request with an empty body and persists nothing", async () => {
    const before = await query("SELECT count(*)::int FROM charges WHERE learner_id = $1", [learnerId]);
    const response = await POST(makeRequest("http://localhost/api/learners/payments", { method: "POST", body: "null" }));
    expect(response.status).toBe(400);
    const after = await query("SELECT count(*)::int FROM charges WHERE learner_id = $1", [learnerId]);
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });
});

describe("GET /api/learners/balances (stays charges-based)", () => {
  it("does not show a mandatory fee for a learner who has never been charged for it", async () => {
    // A fresh learner untouched by any payment in this suite — "Test Fee" is
    // MANDATORY/ALL_LEARNERS/ALL_PERIODS by default (set in beforeAll), so
    // this learner would appear on the Unpaid Mandatory Payments page, but
    // /owing (this endpoint) is deliberately scoped to real charges only —
    // a never-charged fee stays invisible here regardless of priority.
    const [neverPaid] = await createLearners([{
      school_id: SCHOOL,
      first_name: "Never",
      last_name: "Paid",
      gender_id: genderId,
      date_of_birth: "2015-01-01",
      class_category_id: classId,
      academic_year_id: yearId,
    }]);

    const response = await GET_BALANCES(makeRequest(`http://localhost/api/learners/balances?school_id=${SCHOOL}&learner_id=${neverPaid.learner_id}`));
    expect(response.status).toBe(200);

    const rows = await readJson(response);
    expect(rows).toEqual([]);

    await query("DELETE FROM enrolments WHERE learner_id = $1", [neverPaid.learner_id]);
    await query("DELETE FROM learners WHERE learner_id = $1", [neverPaid.learner_id]);
  });
});

describe("GET /api/learners/payments (retrieve + filters)", () => {
  it("returns a recorded payment via GET and matches Postgres exactly", async () => {
    const [created] = await readJson(await POST(makeRequest("http://localhost/api/learners/payments", {
      method: "POST",
      body: JSON.stringify(makePaymentInput(75)),
    })));

    const response = await GET(makeRequest(`http://localhost/api/learners/payments?learner_id=${learnerId}`));
    const body = await readJson(response);
    const match = body.find((row: { charge_id: number }) => row.charge_id === created.charge.charge_id);
    expect(match).toBeDefined();
    expect(Number(match.amount)).toBe(75);
    expect(match).toMatchObject({ income_name: "Test Fee", period_name: "Test Term", method_name: "Test Cash" });
  });

  it("returns an empty array for a nonexistent learner_id filter", async () => {
    const response = await GET(makeRequest("http://localhost/api/learners/payments?learner_id=NOSUCHID"));
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual([]);
  });
});

describe("DELETE /api/learners/payments (delete a charge)", () => {
  it("deletes a charge (and its now-unallocated payment): it no longer appears via GET or in Postgres", async () => {
    const [created] = await readJson(await POST(makeRequest("http://localhost/api/learners/payments", {
      method: "POST",
      body: JSON.stringify(makePaymentInput(30)),
    })));
    const chargeId = created.charge.charge_id;
    const paymentId = created.payment.payment_id;

    const deleteResponse = await DELETE(makeRequest(`http://localhost/api/learners/payments?charge_id=${chargeId}`, { method: "DELETE" }));
    expect(deleteResponse.status).toBe(201);

    const getResponse = await GET(makeRequest(`http://localhost/api/learners/payments?learner_id=${learnerId}`));
    const rows = await readJson(getResponse);
    expect(rows.some((row: { charge_id: number }) => row.charge_id === chargeId)).toBe(false);

    const dbCharge = await query("SELECT 1 FROM charges WHERE charge_id = $1", [chargeId]);
    expect(dbCharge.rowCount).toBe(0);

    const dbPayment = await query("SELECT 1 FROM payments WHERE payment_id = $1", [paymentId]);
    expect(dbPayment.rowCount).toBe(0);
  });

  it("rejects deleting a nonexistent charge_id", async () => {
    const response = await DELETE(makeRequest("http://localhost/api/learners/payments?charge_id=999999999", { method: "DELETE" }));
    expect(response.status).toBe(500);
  });

  it("rejects a delete request missing charge_id", async () => {
    const response = await DELETE(makeRequest("http://localhost/api/learners/payments", { method: "DELETE" }));
    expect(response.status).toBe(400);
  });
});

describe("Soft-deleted learners are excluded from payments/balances (regression)", () => {
  it("a payment for a soft-deleted learner no longer appears via GET /api/learners/payments or /api/learners/balances", async () => {
    const [softDeleteLearner] = await createLearners([{
      school_id: SCHOOL,
      first_name: "Soon",
      last_name: "Deleted",
      gender_id: genderId,
      date_of_birth: "2015-01-01",
      class_category_id: classId,
      academic_year_id: yearId,
    }]);
    const enrolmentRow = await query("SELECT enrolment_id FROM enrolments WHERE learner_id = $1", [softDeleteLearner.learner_id]);
    const softDeleteEnrolmentId = Number(enrolmentRow.rows[0].enrolment_id);

    const [created] = await readJson(await POST(makeRequest("http://localhost/api/learners/payments", {
      method: "POST",
      body: JSON.stringify({
        learner_id: softDeleteLearner.learner_id,
        enrolment_id: softDeleteEnrolmentId,
        payment_period_id: paymentPeriodId,
        academic_year_id: yearId,
        payment_method_id: paymentMethodId,
        income_categories: [{ income_category_id: incomeCategoryId, amount: 60 }],
      }),
    })));

    await DELETE_LEARNER(makeRequest(`http://localhost/api/learners?learner_id=${softDeleteLearner.learner_id}`, { method: "DELETE" }));

    const learnerGet = await GET_LEARNERS(makeRequest(`http://localhost/api/learners?learner_id=${softDeleteLearner.learner_id}`));
    expect(await readJson(learnerGet)).toEqual([]);

    const paymentsGet = await GET(makeRequest(`http://localhost/api/learners/payments?learner_id=${softDeleteLearner.learner_id}`));
    expect(await readJson(paymentsGet)).toEqual([]);

    const balancesGet = await GET_BALANCES(makeRequest(`http://localhost/api/learners/balances?school_id=${SCHOOL}&learner_id=${softDeleteLearner.learner_id}`));
    expect(await readJson(balancesGet)).toEqual([]);

    // cleanup: this learner's charge/payment/enrolment aren't touched by DELETE_LEARNER (soft delete only)
    await query("DELETE FROM payment_allocations WHERE charge_id = $1", [created.charge.charge_id]);
    await query("DELETE FROM payments WHERE payment_id = $1", [created.payment.payment_id]);
    await query("DELETE FROM charges WHERE charge_id = $1", [created.charge.charge_id]);
    await query("DELETE FROM enrolments WHERE learner_id = $1", [softDeleteLearner.learner_id]);
    await query("DELETE FROM learners WHERE learner_id = $1", [softDeleteLearner.learner_id]);
  });
});
