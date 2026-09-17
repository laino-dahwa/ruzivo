import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as GET_OBLIGATIONS } from "../app/api/schools/[school_id]/obligations/route";
import { GET as GET_BALANCES } from "../app/api/learners/balances/route";
import { createSchool } from "../repositories/school/create/createSchool";
import { createGender } from "../repositories/school/create/createGenderCategory";
import { createClassCategory } from "../repositories/school/create/createClassCategory";
import { createAcademicYear } from "../repositories/school/create/createAcademicYear";
import { createPaymentPeriod } from "../repositories/school/create/createPaymentPeriod";
import { createPaymentMethod } from "../repositories/school/create/createPaymentMethod";
import { createIncomeCategory } from "../repositories/school/create/createIncomeCategory";
import { createLearners } from "../repositories/learner/create/addLearner";
import { createChargesWithPayments } from "../repositories/payment/create/createNewPayment";
import { query } from "../lib/db";

// A never-charged learner used to be structurally invisible everywhere
// "owing" was computed, because every such query reached income_categories
// only via an INNER JOIN through charges — and charges are only ever written
// at payment time. This suite exercises the fix: obligations for a MANDATORY
// category are now enumerated from the learner's own enrolment/applicability,
// independent of whether a charge has ever been created.
const SCHOOL = "OBG";
const OTHER_SCHOOL = "OBH";

let classAId: number;
let classBId: number;
let yearId: number;
let termAId: number;
let methodId: number;
let genderId: number;

function makeParams(school_id: string) {
  return { params: Promise.resolve({ school_id }) };
}

function makeRequest(url: string) {
  return new Request(url);
}

async function readJson(response: Response) {
  return response.json();
}

async function enrolLearner(firstName: string, classCategoryId: number) {
  const [learner] = await createLearners([{
    school_id: SCHOOL,
    first_name: firstName,
    last_name: "Learner",
    gender_id: genderId,
    date_of_birth: "2015-01-01",
    class_category_id: classCategoryId,
    academic_year_id: yearId,
  }]);
  const enrolment = await query(`SELECT enrolment_id FROM enrolments WHERE learner_id = $1`, [learner.learner_id]);
  return { learnerId: learner.learner_id, enrolmentId: Number(enrolment.rows[0].enrolment_id) };
}

async function pay(learnerId: string, enrolmentId: number, incomeCategoryId: number, periodId: number, amount: number) {
  return createChargesWithPayments([{
    learner_id: learnerId,
    enrolment_id: enrolmentId,
    payment_period_id: periodId,
    academic_year_id: yearId,
    payment_method_id: methodId,
    income_categories: [{ income_category_id: incomeCategoryId, amount }],
  }]);
}

beforeAll(async () => {
  await createSchool([
    { school_id: SCHOOL, school_name: "Obligations Test", school_type: "primary", school_address: "n/a", school_contact: "n/a", school_email: "obg@test.local" },
    { school_id: OTHER_SCHOOL, school_name: "Obligations Test Other", school_type: "primary", school_address: "n/a", school_contact: "n/a", school_email: "obh@test.local" },
  ]);

  const [gender] = await createGender([{ school_id: SCHOOL, gender_name: "Test" }]);
  genderId = gender.gender_id;
  const [classA] = await createClassCategory([{ school_id: SCHOOL, class_name: "Class A" }]);
  const [classB] = await createClassCategory([{ school_id: SCHOOL, class_name: "Class B" }]);
  classAId = classA.class_category_id;
  classBId = classB.class_category_id;
  const [year] = await createAcademicYear([{ school_id: SCHOOL, academic_year_name: "2026", start_date: "2026-01-01", end_date: "2026-12-31" }]);
  yearId = year.academic_year_id;
  const [termA] = await createPaymentPeriod([{ school_id: SCHOOL, period_name: "Term A" }]);
  // Term B's id is never referenced directly — its role is just existing, so
  // Term A's SPECIFIC_PERIODS scoping has a real second period to exclude.
  await createPaymentPeriod([{ school_id: SCHOOL, period_name: "Term B" }]);
  termAId = termA.payment_period_id;
  const [method] = await createPaymentMethod([{ school_id: SCHOOL, method_name: "Cash" }]);
  methodId = method.payment_method_id;
});

afterAll(async () => {
  // Scoped to exactly this school's own charges/payments — a broad sweep
  // (e.g. "payments not referenced by any allocation") could touch another
  // test file's data if suites share the database.
  const charges = await query(
    `SELECT charge_id FROM charges WHERE learner_id IN (SELECT learner_id FROM learners WHERE school_id = $1)`,
    [SCHOOL]
  );
  const chargeIds = charges.rows.map((row) => row.charge_id);
  if (chargeIds.length > 0) {
    const allocations = await query(`SELECT payment_id FROM payment_allocations WHERE charge_id = ANY($1::bigint[])`, [chargeIds]);
    await query(`DELETE FROM payment_allocations WHERE charge_id = ANY($1::bigint[])`, [chargeIds]);
    const paymentIds = allocations.rows.map((row) => row.payment_id);
    if (paymentIds.length > 0) {
      await query(`DELETE FROM payments WHERE payment_id = ANY($1::bigint[])`, [paymentIds]);
    }
    await query(`DELETE FROM charges WHERE charge_id = ANY($1::bigint[])`, [chargeIds]);
  }
  await query(`DELETE FROM enrolments WHERE learner_id IN (SELECT learner_id FROM learners WHERE school_id = $1)`, [SCHOOL]);
  await query(`DELETE FROM learners WHERE school_id = $1`, [SCHOOL]);
  // income_categories (and the applicability join tables that cascade from
  // it) and class_categories/payment_periods/academic_years all cascade from
  // schools, so deleting the schools cleans up everything else created above.
  await query(`DELETE FROM schools WHERE school_id = ANY($1::char(4)[])`, [[SCHOOL, OTHER_SCHOOL]]);
});

describe("mandatory obligations appear before any payment", () => {
  it("shows a never-charged learner owing a mandatory, all-learners, all-periods fee", async () => {
    await createIncomeCategory([{ school_id: SCHOOL, income_name: "Base Fee", income_limit: "500" }]);
    const { learnerId } = await enrolLearner("NeverPaid", classAId);

    const response = await GET_OBLIGATIONS(makeRequest(`http://localhost/x?learner_id=${learnerId}`), makeParams(SCHOOL));
    const rows = await readJson(response);
    const row = rows.find((r: { income_name: string }) => r.income_name === "Base Fee");

    expect(row).toBeDefined();
    expect(Number(row.expected)).toBe(500);
    expect(Number(row.paid)).toBe(0);
    expect(Number(row.balance)).toBe(500);
    expect(row.status).toBe("NO_PAYMENT");
    expect(row.priority).toBe("MANDATORY");
  });

  it("excludes a learner outside the fee's SPECIFIC_CLASSES scope", async () => {
    const [category] = await createIncomeCategory([{
      school_id: SCHOOL, income_name: "Class A Only Fee", income_limit: "200",
      class_applicability: "SPECIFIC_CLASSES", class_category_ids: [classAId],
    }]);
    const inScope = await enrolLearner("InClassA", classAId);
    const outOfScope = await enrolLearner("InClassB", classBId);

    const inScopeRows = await readJson(await GET_OBLIGATIONS(makeRequest(`http://localhost/x?learner_id=${inScope.learnerId}`), makeParams(SCHOOL)));
    expect(inScopeRows.some((r: { income_name: string }) => r.income_name === "Class A Only Fee")).toBe(true);

    const outOfScopeRows = await readJson(await GET_OBLIGATIONS(makeRequest(`http://localhost/x?learner_id=${outOfScope.learnerId}`), makeParams(SCHOOL)));
    expect(outOfScopeRows.some((r: { income_name: string }) => r.income_name === "Class A Only Fee")).toBe(false);

    await query(`DELETE FROM income_categories WHERE income_category_id = $1`, [category.income_category_id]);
  });

  it("only applies to the periods it's configured for", async () => {
    const [category] = await createIncomeCategory([{
      school_id: SCHOOL, income_name: "Term A Only Fee", income_limit: "150",
      period_applicability: "SPECIFIC_PERIODS", payment_period_ids: [termAId],
    }]);
    const { learnerId } = await enrolLearner("PeriodScoped", classAId);

    const rows = await readJson(await GET_OBLIGATIONS(makeRequest(`http://localhost/x?learner_id=${learnerId}&income_category_id=${category.income_category_id}`), makeParams(SCHOOL)));
    const periods = rows.map((r: { period_name: string }) => r.period_name);
    expect(periods).toContain("Term A");
    expect(periods).not.toContain("Term B");

    await query(`DELETE FROM income_categories WHERE income_category_id = $1`, [category.income_category_id]);
  });

  it("excludes a MANDATORY fee with no configured limit — a pre-existing quirk, preserved rather than fixed here", async () => {
    const [category] = await createIncomeCategory([{ school_id: SCHOOL, income_name: "Unlimited Fee", income_limit: null }]);
    const { learnerId } = await enrolLearner("UnlimitedFeeLearner", classAId);

    const rows = await readJson(await GET_OBLIGATIONS(makeRequest(`http://localhost/x?learner_id=${learnerId}&income_category_id=${category.income_category_id}`), makeParams(SCHOOL)));
    expect(rows).toEqual([]);

    await query(`DELETE FROM income_categories WHERE income_category_id = $1`, [category.income_category_id]);
  });
});

describe("optional obligations only appear once engaged with", () => {
  it("never surfaces an optional fee nobody has paid toward", async () => {
    const [category] = await createIncomeCategory([{ school_id: SCHOOL, income_name: "Swimming", income_limit: "50", priority: "OPTIONAL" }]);
    const { learnerId } = await enrolLearner("NeverSwam", classAId);

    const rows = await readJson(await GET_OBLIGATIONS(makeRequest(`http://localhost/x?learner_id=${learnerId}`), makeParams(SCHOOL)));
    expect(rows.some((r: { income_name: string }) => r.income_name === "Swimming")).toBe(false);

    await query(`DELETE FROM income_categories WHERE income_category_id = $1`, [category.income_category_id]);
  });

  it("surfaces an optional fee once a payment has been made toward it", async () => {
    const [category] = await createIncomeCategory([{ school_id: SCHOOL, income_name: "Chess Club", income_limit: "50", priority: "OPTIONAL" }]);
    const { learnerId, enrolmentId } = await enrolLearner("PlaysChess", classAId);

    await pay(learnerId, enrolmentId, category.income_category_id, termAId, 20);

    const rows = await readJson(await GET_OBLIGATIONS(makeRequest(`http://localhost/x?learner_id=${learnerId}`), makeParams(SCHOOL)));
    const row = rows.find((r: { income_name: string }) => r.income_name === "Chess Club");
    expect(row).toBeDefined();
    expect(Number(row.paid)).toBe(20);
    expect(Number(row.balance)).toBe(30);
    expect(row.status).toBe("PARTIALLY_PAID");

    // Not inline-deleted: a real charge now references this category (a
    // non-cascading FK), so cleanup is left to afterAll, which removes
    // charges/payments in the right order before the category itself.
  });
});

describe("an optional fee paid once cascades forward through every later missed period", () => {
  it("shows an unpaid obligation for the successor period when the prior period was paid", async () => {
    // Period names have to actually read as calendar months for this to
    // fire — matches the existing client-side convention in
    // payments-view.tsx that defaults the period picker to "this month".
    const [march] = await createPaymentPeriod([{ school_id: SCHOOL, period_name: "March" }]);
    // April's id is never referenced directly — its role is just existing,
    // so March's successor has a real row to be found.
    await createPaymentPeriod([{ school_id: SCHOOL, period_name: "April" }]);
    const [category] = await createIncomeCategory([{ school_id: SCHOOL, income_name: "Art Club", income_limit: "40", priority: "OPTIONAL" }]);
    const { learnerId, enrolmentId } = await enrolLearner("PaidMarch", classAId);

    await pay(learnerId, enrolmentId, category.income_category_id, march.payment_period_id, 40);

    const rows = await readJson(await GET_OBLIGATIONS(makeRequest(`http://localhost/x?learner_id=${learnerId}&income_category_id=${category.income_category_id}`), makeParams(SCHOOL)));
    expect(rows).toHaveLength(2);

    const marchRow = rows.find((r: { period_name: string }) => r.period_name === "March");
    expect(marchRow.status).toBe("FULLY_PAID");

    const aprilRow = rows.find((r: { period_name: string }) => r.period_name === "April");
    expect(aprilRow).toBeDefined();
    expect(Number(aprilRow.paid)).toBe(0);
    expect(Number(aprilRow.expected)).toBe(40);
    expect(aprilRow.status).toBe("NO_PAYMENT");

    // /owing stays charges-based and must not pick up the projected row.
    const balances = await readJson(await GET_BALANCES(makeRequest(`http://localhost/api/learners/balances?school_id=${SCHOOL}&learner_id=${learnerId}`)));
    expect(balances.some((b: { period_name: string }) => b.period_name === "April")).toBe(false);
  });

  it("keeps flagging every later applicable period, not just the first miss, until a payment resumes", async () => {
    // Scoped to exactly these three periods (SPECIFIC_PERIODS), so the
    // chain is deterministic regardless of what other tests have created in
    // this school by the time this one runs. Names picked to avoid clashing
    // with month names other tests in this file already registered.
    const [jan] = await createPaymentPeriod([{ school_id: SCHOOL, period_name: "January" }]);
    const [feb] = await createPaymentPeriod([{ school_id: SCHOOL, period_name: "February" }]);
    const [oct] = await createPaymentPeriod([{ school_id: SCHOOL, period_name: "October" }]);
    const [category] = await createIncomeCategory([{
      school_id: SCHOOL, income_name: "Music Lessons", income_limit: "40", priority: "OPTIONAL",
      period_applicability: "SPECIFIC_PERIODS",
      payment_period_ids: [jan.payment_period_id, feb.payment_period_id, oct.payment_period_id],
    }]);
    const { learnerId, enrolmentId } = await enrolLearner("PaidJanOnly", classAId);

    // Paid January only — nothing since, skipping February AND October.
    await pay(learnerId, enrolmentId, category.income_category_id, jan.payment_period_id, 40);

    const rows = await readJson(await GET_OBLIGATIONS(makeRequest(`http://localhost/x?learner_id=${learnerId}&income_category_id=${category.income_category_id}`), makeParams(SCHOOL)));
    expect(rows).toHaveLength(3);

    const byPeriod = Object.fromEntries(rows.map((r: { period_name: string; status: string; paid: string }) => [r.period_name, r]));
    expect(byPeriod.January.status).toBe("FULLY_PAID");
    // Both February and October are flagged — the old one-hop design would
    // have stopped after February.
    expect(byPeriod.February.status).toBe("NO_PAYMENT");
    expect(Number(byPeriod.February.paid)).toBe(0);
    expect(byPeriod.October.status).toBe("NO_PAYMENT");
    expect(Number(byPeriod.October.paid)).toBe(0);
  });

  it("does not duplicate the projected row once the successor period gets a real charge of its own", async () => {
    const [may] = await createPaymentPeriod([{ school_id: SCHOOL, period_name: "May" }]);
    const [june] = await createPaymentPeriod([{ school_id: SCHOOL, period_name: "June" }]);
    // Bounded to exactly these two periods: with ALL_PERIODS the cascade
    // would otherwise also pick up any later month-named period other tests
    // in this file have registered in the same shared school.
    const [category] = await createIncomeCategory([{
      school_id: SCHOOL, income_name: "Drama Club", income_limit: "40", priority: "OPTIONAL",
      period_applicability: "SPECIFIC_PERIODS",
      payment_period_ids: [may.payment_period_id, june.payment_period_id],
    }]);
    const { learnerId, enrolmentId } = await enrolLearner("PaidBoth", classAId);

    await pay(learnerId, enrolmentId, category.income_category_id, may.payment_period_id, 40);
    await pay(learnerId, enrolmentId, category.income_category_id, june.payment_period_id, 15);

    const rows = await readJson(await GET_OBLIGATIONS(makeRequest(`http://localhost/x?learner_id=${learnerId}&income_category_id=${category.income_category_id}`), makeParams(SCHOOL)));
    expect(rows).toHaveLength(2);
    const juneRow = rows.find((r: { period_name: string }) => r.period_name === "June");
    expect(Number(juneRow.paid)).toBe(15);
    expect(juneRow.status).toBe("PARTIALLY_PAID");
  });

  it("respects the fee's own 'Selected periods' scoping: never projects into a successor period the fee doesn't apply to", async () => {
    const [november] = await createPaymentPeriod([{ school_id: SCHOOL, period_name: "November" }]);
    await createPaymentPeriod([{ school_id: SCHOOL, period_name: "December" }]);
    // Scoped to November only — December is deliberately left out.
    const [category] = await createIncomeCategory([{
      school_id: SCHOOL, income_name: "Ballet", income_limit: "40", priority: "OPTIONAL",
      period_applicability: "SPECIFIC_PERIODS", payment_period_ids: [november.payment_period_id],
    }]);
    const { learnerId, enrolmentId } = await enrolLearner("PaidNovember", classAId);

    await pay(learnerId, enrolmentId, category.income_category_id, november.payment_period_id, 40);

    const rows = await readJson(await GET_OBLIGATIONS(makeRequest(`http://localhost/x?learner_id=${learnerId}&income_category_id=${category.income_category_id}`), makeParams(SCHOOL)));
    // Only the real November charge — no manufactured December row, since
    // the fee isn't configured to apply there at all.
    expect(rows).toHaveLength(1);
    expect(rows[0].period_name).toBe("November");
  });

  it("does not project a mandatory fee (that branch already covers every period on its own)", async () => {
    const [july] = await createPaymentPeriod([{ school_id: SCHOOL, period_name: "July" }]);
    await createPaymentPeriod([{ school_id: SCHOOL, period_name: "August" }]);
    const [category] = await createIncomeCategory([{ school_id: SCHOOL, income_name: "July Mandatory Fee", income_limit: "40" }]);
    const { learnerId, enrolmentId } = await enrolLearner("MandatoryJuly", classAId);

    await pay(learnerId, enrolmentId, category.income_category_id, july.payment_period_id, 40);

    // Mandatory fees already appear in every period via the `mandatory`
    // branch, so exactly one row per period (no extra row from
    // `optional_recurring`, which only ever fires for OPTIONAL categories).
    const rows = await readJson(await GET_OBLIGATIONS(makeRequest(`http://localhost/x?learner_id=${learnerId}&income_category_id=${category.income_category_id}`), makeParams(SCHOOL)));
    const augustRows = rows.filter((r: { period_name: string }) => r.period_name === "August");
    expect(augustRows).toHaveLength(1);
  });
});

describe("payment status and aggregation", () => {
  it("sums multiple instalments toward the same fee without double-counting", async () => {
    const [category] = await createIncomeCategory([{ school_id: SCHOOL, income_name: "Instalment Fee", income_limit: "300" }]);
    const { learnerId, enrolmentId } = await enrolLearner("PaysInInstalments", classAId);

    await pay(learnerId, enrolmentId, category.income_category_id, termAId, 100);
    await pay(learnerId, enrolmentId, category.income_category_id, termAId, 100);

    // Scoped to Term A specifically: the fee applies to every period by
    // default, so Term B would otherwise contribute its own separate,
    // unpaid obligation row for the same learner+category.
    const rows = await readJson(await GET_OBLIGATIONS(
      makeRequest(`http://localhost/x?learner_id=${learnerId}&income_category_id=${category.income_category_id}&payment_period_id=${termAId}`),
      makeParams(SCHOOL)
    ));
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].paid)).toBe(200);
    expect(Number(rows[0].balance)).toBe(100);
    expect(rows[0].status).toBe("PARTIALLY_PAID");
  });

  it("marks a fully paid fee FULLY_PAID and excludes it when filtering for NO_PAYMENT", async () => {
    const [category] = await createIncomeCategory([{ school_id: SCHOOL, income_name: "Settled Fee", income_limit: "80" }]);
    const { learnerId, enrolmentId } = await enrolLearner("PaysInFull", classAId);

    await pay(learnerId, enrolmentId, category.income_category_id, termAId, 80);

    const allRows = await readJson(await GET_OBLIGATIONS(
      makeRequest(`http://localhost/x?learner_id=${learnerId}&income_category_id=${category.income_category_id}&payment_period_id=${termAId}`),
      makeParams(SCHOOL)
    ));
    expect(allRows).toHaveLength(1);
    expect(allRows[0].status).toBe("FULLY_PAID");

    const noPaymentRows = await readJson(await GET_OBLIGATIONS(
      makeRequest(`http://localhost/x?learner_id=${learnerId}&income_category_id=${category.income_category_id}&payment_period_id=${termAId}&status=NO_PAYMENT`),
      makeParams(SCHOOL)
    ));
    expect(noPaymentRows).toEqual([]);
  });
});

describe("filters combine with AND", () => {
  it("narrows by class and status together", async () => {
    // Dedicated classes rather than the shared classAId/classBId: this fee
    // is MANDATORY/ALL_LEARNERS, so it also applies to every other learner
    // earlier tests already enrolled into classAId/classBId — reusing those
    // would make the class filter match more than just this test's rows.
    const [classX] = await createClassCategory([{ school_id: SCHOOL, class_name: "Combined Class X" }]);
    const [classY] = await createClassCategory([{ school_id: SCHOOL, class_name: "Combined Class Y" }]);
    const [category] = await createIncomeCategory([{ school_id: SCHOOL, income_name: "Combined Filter Fee", income_limit: "60" }]);
    const a = await enrolLearner("CombinedA", classX.class_category_id);
    const b = await enrolLearner("CombinedB", classY.class_category_id);
    await pay(a.learnerId, a.enrolmentId, category.income_category_id, termAId, 60); // fully paid

    const rows = await readJson(await GET_OBLIGATIONS(
      makeRequest(`http://localhost/x?income_category_id=${category.income_category_id}&class_category_id=${classY.class_category_id}&status=NO_PAYMENT&payment_period_id=${termAId}`),
      makeParams(SCHOOL)
    ));
    // Only b (Class Y, no payment) should match — a is the wrong class filter
    // and is fully paid anyway.
    expect(rows).toHaveLength(1);
    expect(rows[0].learner_id).toBe(b.learnerId);
  });
});

describe("cross-tenant isolation", () => {
  it("never leaks one school's obligations into another's", async () => {
    const [otherGender] = await createGender([{ school_id: OTHER_SCHOOL, gender_name: "Test" }]);
    const [otherClass] = await createClassCategory([{ school_id: OTHER_SCHOOL, class_name: "Other Class" }]);
    const [otherYear] = await createAcademicYear([{ school_id: OTHER_SCHOOL, academic_year_name: "2026", start_date: "2026-01-01", end_date: "2026-12-31" }]);
    await createPaymentPeriod([{ school_id: OTHER_SCHOOL, period_name: "Other Term" }]);
    await createIncomeCategory([{ school_id: OTHER_SCHOOL, income_name: "Other School Fee", income_limit: "999" }]);
    const [otherLearner] = await createLearners([{
      school_id: OTHER_SCHOOL, first_name: "Other", last_name: "School", gender_id: otherGender.gender_id,
      date_of_birth: "2015-01-01", class_category_id: otherClass.class_category_id, academic_year_id: otherYear.academic_year_id,
    }]);

    const obligationsResponse = await readJson(await GET_OBLIGATIONS(makeRequest("http://localhost/x"), makeParams(SCHOOL)));
    expect(obligationsResponse.some((r: { income_name: string }) => r.income_name === "Other School Fee")).toBe(false);

    const balancesResponse = await readJson(await GET_BALANCES(makeRequest(`http://localhost/api/learners/balances?school_id=${SCHOOL}`)));
    expect(balancesResponse.some((r: { learner_id: string }) => r.learner_id === otherLearner.learner_id)).toBe(false);

    await query(`DELETE FROM enrolments WHERE learner_id = $1`, [otherLearner.learner_id]);
    await query(`DELETE FROM learners WHERE learner_id = $1`, [otherLearner.learner_id]);
  });
});

describe("PDF export", () => {
  it("exports the obligations table as a valid PDF", async () => {
    const response = await GET_OBLIGATIONS(makeRequest("http://localhost/x?format=pdf"), makeParams(SCHOOL));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");

    const buffer = Buffer.from(await response.arrayBuffer());
    expect(buffer.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });
});
