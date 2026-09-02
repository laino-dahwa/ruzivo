import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getPaymentsReportRoute } from "../app/api/schools/[school_id]/reports/payments/route";
import { GET as getOwingReportRoute } from "../app/api/schools/[school_id]/reports/owing/route";
import { GET as getExpensesReportRoute } from "../app/api/schools/[school_id]/reports/expenses/route";
import { GET as getSummaryRoute } from "../app/api/schools/[school_id]/reports/summary/route";
import { createSchool } from "../repositories/school/create/createSchool";
import { createClassCategory } from "../repositories/school/create/createClassCategory";
import { createPaymentPeriod } from "../repositories/school/create/createPaymentPeriod";
import { createIncomeCategory } from "../repositories/school/create/createIncomeCategory";
import { createAcademicYear } from "../repositories/school/create/createAcademicYear";
import { createPaymentMethod } from "../repositories/school/create/createPaymentMethod";
import { createGender } from "../repositories/school/create/createGenderCategory";
import { createExpenseCategory } from "../repositories/school/create/createExpenseCategory";
import { createExpense } from "../repositories/school/create/createExpense";
import { createLearners } from "../repositories/learner/create/addLearner";
import { getLearners } from "../repositories/learner/read/getLearners";
import { createChargesWithPayments } from "../repositories/payment/create/createNewPayment";
import { query } from "../lib/db";

// Two disposable test schools so report school-scoping (cross-tenant
// isolation) can be verified, plus a third empty school for the
// no-records case. Everything created here is removed in afterAll.
// Exactly 3 characters: learner_id generation appends a 5-char random suffix
// to school_id and the learner_id column is VARCHAR(8), so a school_id longer
// than 3 characters overflows it (see report's "Issues found" for detail).
const SCHOOL_1 = "TR1";
const SCHOOL_2 = "TR2";
const SCHOOL_EMPTY = "TR3";

const DATE_A = "2026-08-15"; // learner A: charged + partially paid
const DATE_B = "2026-08-20"; // learner B: charged, never paid (raw-inserted, no payment)
const DATE_NONE = "2026-08-16"; // a date with no records at all

function makeParams(school_id: string) {
    return { params: Promise.resolve({ school_id }) };
}

function makeRequest(url: string) {
    return new Request(url);
}

async function readJson(response: Response) {
    return response.json();
}

type SchoolFixture = {
    schoolId: string;
    classCategoryId: number;
    paymentPeriodId: number;
    incomeCategoryId: number;
    incomeLimit: number;
    academicYearId: number;
    paymentMethodId: number;
    expenseCategoryId: number;
    genderId: number;
};

async function buildSchoolFixture(schoolId: string, incomeLimit: number): Promise<SchoolFixture> {
    await createSchool([{ school_id: schoolId, school_name: `Report Test ${schoolId}`, school_type: "primary", school_address: "n/a", school_contact: "n/a", school_email: `${schoolId}@test.local` }]);
    const [classCategory] = await createClassCategory([{ school_id: schoolId, class_name: "Test Class" }]);
    const [paymentPeriod] = await createPaymentPeriod([{ school_id: schoolId, period_name: "Term 1" }]);
    const [incomeCategory] = await createIncomeCategory([{ school_id: schoolId, income_name: "Tuition", income_limit: String(incomeLimit) }]);
    const [academicYear] = await createAcademicYear([{ school_id: schoolId, academic_year_name: "2026", start_date: "2026-01-01", end_date: "2026-12-31" }]);
    const [paymentMethod] = await createPaymentMethod([{ school_id: schoolId, method_name: "Cash" }]);
    const [expenseCategory] = await createExpenseCategory([{ school_id: schoolId, expense_name: "Utilities" }]);
    const [gender] = await createGender([{ school_id: schoolId, gender_name: "Male" }]);

    return {
        schoolId,
        classCategoryId: classCategory.class_category_id,
        paymentPeriodId: paymentPeriod.payment_period_id,
        incomeCategoryId: incomeCategory.income_category_id,
        incomeLimit,
        academicYearId: academicYear.academic_year_id,
        paymentMethodId: paymentMethod.payment_method_id,
        expenseCategoryId: expenseCategory.expense_category_id,
        genderId: gender.gender_id,
    };
}

async function addLearnerWithEnrolment(fixture: SchoolFixture, firstName: string) {
    const [prepared] = await createLearners([{
        school_id: fixture.schoolId,
        first_name: firstName,
        last_name: "Test",
        gender_id: fixture.genderId,
        date_of_birth: "2015-01-01",
        class_category_id: fixture.classCategoryId,
        academic_year_id: fixture.academicYearId,
    }]);
    const [learner] = await getLearners(prepared.learner_id, null, null, null);
    return { learner_id: prepared.learner_id as string, enrolment_id: learner.enrolment_id as number };
}

async function backdateTimestamp(table: "charges" | "payments", idColumn: string, id: number, isoWithOffset: string) {
    await query(`UPDATE ${table} SET ${table === "charges" ? "created_at" : "paid_at"} = $1 WHERE ${idColumn} = $2`, [isoWithOffset, id]);
}

let school1: SchoolFixture;
let school2: SchoolFixture;

beforeAll(async () => {
    school1 = await buildSchoolFixture(SCHOOL_1, 500);
    school2 = await buildSchoolFixture(SCHOOL_2, 100);
    await createSchool([{ school_id: SCHOOL_EMPTY, school_name: "Report Test Empty", school_type: "primary", school_address: "n/a", school_contact: "n/a", school_email: "empty@test.local" }]);

    // School 1 / Learner A: charged 500, paid 200 on DATE_A -> outstanding 300, "Partially Paid".
    const learnerA = await addLearnerWithEnrolment(school1, "Alice");
    const [{ charge: chargeA, payment: paymentA }] = await createChargesWithPayments({
        learner_id: learnerA.learner_id,
        enrolment_id: learnerA.enrolment_id,
        payment_period_id: school1.paymentPeriodId,
        academic_year_id: school1.academicYearId,
        payment_method_id: school1.paymentMethodId,
        income_categories: [{ income_category_id: school1.incomeCategoryId, amount: 200 }],
    });
    await backdateTimestamp("charges", "charge_id", chargeA.charge_id, `${DATE_A}T10:00:00+02:00`);
    await backdateTimestamp("payments", "payment_id", paymentA.payment_id, `${DATE_A}T10:00:00+02:00`);

    // School 1 / Learner B: charged 500 on DATE_B, never paid -> outstanding 500, "Unpaid".
    // Inserted raw because the app's only charge-creation path (createChargesWithPayments)
    // always pairs a charge with a payment; this proves the report still surfaces a
    // fully-unpaid charge (LEFT JOIN), which an INNER JOIN would silently drop.
    const learnerB = await addLearnerWithEnrolment(school1, "Bilal");
    await query(
        `INSERT INTO charges (learner_id, enrolment_id, income_category_id, payment_period_id, academic_year_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING charge_id`,
        [learnerB.learner_id, learnerB.enrolment_id, school1.incomeCategoryId, school1.paymentPeriodId, school1.academicYearId, `${DATE_B}T09:00:00+02:00`]
    );

    // School 1 expenses: one on DATE_A, one on DATE_B.
    await createExpense([{ expense_category_id: String(school1.expenseCategoryId), amount: 50, expense_date: DATE_A, description: "Report test expense A" }]);
    await createExpense([{ expense_category_id: String(school1.expenseCategoryId), amount: 30, expense_date: DATE_B, description: "Report test expense B" }]);

    // School 2: charged 100, paid 100 in full on DATE_A -> balance 0, must NOT appear as owing,
    // and must never appear under School 1's reports (tenant isolation).
    const learnerC = await addLearnerWithEnrolment(school2, "Chidi");
    const [{ charge: chargeC, payment: paymentC }] = await createChargesWithPayments({
        learner_id: learnerC.learner_id,
        enrolment_id: learnerC.enrolment_id,
        payment_period_id: school2.paymentPeriodId,
        academic_year_id: school2.academicYearId,
        payment_method_id: school2.paymentMethodId,
        income_categories: [{ income_category_id: school2.incomeCategoryId, amount: 100 }],
    });
    await backdateTimestamp("charges", "charge_id", chargeC.charge_id, `${DATE_A}T10:00:00+02:00`);
    await backdateTimestamp("payments", "payment_id", paymentC.payment_id, `${DATE_A}T10:00:00+02:00`);
});

afterAll(async () => {
    // Purge via payment_methods -> payments first (not just via the allocations
    // join) so cleanup is robust even if a previous run's afterAll only got
    // partway through and left orphaned rows behind.
    const schoolIds = [SCHOOL_1, SCHOOL_2, SCHOOL_EMPTY];
    const methodIdsResult = await query(`SELECT payment_method_id FROM payment_methods WHERE school_id = ANY($1::char(4)[])`, [schoolIds]);
    const methodIds = methodIdsResult.rows.map((r) => r.payment_method_id);
    if (methodIds.length > 0) {
        const paymentsResult = await query(`SELECT payment_id FROM payments WHERE payment_method_id = ANY($1::bigint[])`, [methodIds]);
        const paymentIds = paymentsResult.rows.map((r) => r.payment_id);
        if (paymentIds.length > 0) {
            await query(`DELETE FROM payment_allocations WHERE payment_id = ANY($1::bigint[])`, [paymentIds]);
            await query(`DELETE FROM payments WHERE payment_id = ANY($1::bigint[])`, [paymentIds]);
        }
    }

    for (const schoolId of schoolIds) {
        await query(
            `DELETE FROM payment_allocations WHERE charge_id IN (SELECT charge_id FROM charges WHERE learner_id IN (SELECT learner_id FROM learners WHERE school_id = $1))`,
            [schoolId]
        );
        await query(`DELETE FROM charges WHERE learner_id IN (SELECT learner_id FROM learners WHERE school_id = $1)`, [schoolId]);
        await query(`DELETE FROM enrolments WHERE learner_id IN (SELECT learner_id FROM learners WHERE school_id = $1)`, [schoolId]);
        await query(`DELETE FROM learners WHERE school_id = $1`, [schoolId]);
        await query(`DELETE FROM expenses WHERE expense_category_id IN (SELECT expense_category_id FROM expense_categories WHERE school_id = $1)`, [schoolId]);
        await query(`DELETE FROM expense_categories WHERE school_id = $1`, [schoolId]);
        await query(`DELETE FROM income_categories WHERE school_id = $1`, [schoolId]);
        await query(`DELETE FROM academic_years WHERE school_id = $1`, [schoolId]);
        await query(`DELETE FROM payment_periods WHERE school_id = $1`, [schoolId]);
        await query(`DELETE FROM payment_methods WHERE school_id = $1`, [schoolId]);
        await query(`DELETE FROM class_categories WHERE school_id = $1`, [schoolId]);
        await query(`DELETE FROM schools WHERE school_id = $1`, [schoolId]);
    }
});

describe("Payments report", () => {
    it("returns only the payment on the specific date, with the correct total", async () => {
        const response = await getPaymentsReportRoute(makeRequest(`http://localhost/api/schools/${SCHOOL_1}/reports/payments?date=${DATE_A}`), makeParams(SCHOOL_1));
        expect(response.status).toBe(200);
        const body = await readJson(response);
        expect(body.rows).toHaveLength(1);
        expect(body.rows[0].first_name).toBe("Alice");
        expect(Number(body.rows[0].amount)).toBe(200);
        expect(body.total).toBe(200);
    });

    it("returns nothing for a date with no payments", async () => {
        const response = await getPaymentsReportRoute(makeRequest(`http://localhost/api/schools/${SCHOOL_1}/reports/payments?date=${DATE_NONE}`), makeParams(SCHOOL_1));
        const body = await readJson(response);
        expect(body.rows).toHaveLength(0);
        expect(body.total).toBe(0);
    });

    it("returns all payments and correct total for All Dates", async () => {
        const response = await getPaymentsReportRoute(makeRequest(`http://localhost/api/schools/${SCHOOL_1}/reports/payments?date=all`), makeParams(SCHOOL_1));
        const body = await readJson(response);
        expect(body.rows).toHaveLength(1); // learner B was never paid
        expect(body.total).toBe(200);
    });

    it("never includes another school's payments (tenant isolation)", async () => {
        const response = await getPaymentsReportRoute(makeRequest(`http://localhost/api/schools/${SCHOOL_1}/reports/payments?date=all`), makeParams(SCHOOL_1));
        const body = await readJson(response);
        expect(body.rows.every((r: { first_name: string }) => r.first_name !== "Chidi")).toBe(true);
    });

    it("matches a direct PostgreSQL query for the same filter", async () => {
        const response = await getPaymentsReportRoute(makeRequest(`http://localhost/api/schools/${SCHOOL_1}/reports/payments?date=all`), makeParams(SCHOOL_1));
        const body = await readJson(response);
        const dbResult = await query(
            `SELECT COALESCE(SUM(p.amount), 0) AS total FROM payments p
             JOIN payment_allocations pa ON pa.payment_id = p.payment_id
             JOIN charges c ON c.charge_id = pa.charge_id
             JOIN learners l ON l.learner_id = c.learner_id
             WHERE l.school_id = $1`,
            [SCHOOL_1]
        );
        expect(body.total).toBe(Number(dbResult.rows[0].total));
    });

    it("rejects an invalid date", async () => {
        const response = await getPaymentsReportRoute(makeRequest(`http://localhost/api/schools/${SCHOOL_1}/reports/payments?date=2026-13-40`), makeParams(SCHOOL_1));
        expect(response.status).toBe(400);
    });

    it("returns an empty report for a school with no records", async () => {
        const response = await getPaymentsReportRoute(makeRequest(`http://localhost/api/schools/${SCHOOL_EMPTY}/reports/payments?date=all`), makeParams(SCHOOL_EMPTY));
        const body = await readJson(response);
        expect(body.rows).toHaveLength(0);
        expect(body.total).toBe(0);
    });

    it("generates a downloadable PDF for a specific date", async () => {
        const response = await getPaymentsReportRoute(makeRequest(`http://localhost/api/schools/${SCHOOL_1}/reports/payments?date=${DATE_A}&format=pdf`), makeParams(SCHOOL_1));
        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe("application/pdf");
        const buffer = Buffer.from(await response.arrayBuffer());
        expect(buffer.subarray(0, 4).toString("ascii")).toBe("%PDF");
        expect(buffer.length).toBeGreaterThan(500);
    });

    it("generates a downloadable PDF for All Dates", async () => {
        const response = await getPaymentsReportRoute(makeRequest(`http://localhost/api/schools/${SCHOOL_1}/reports/payments?date=all&format=pdf`), makeParams(SCHOOL_1));
        expect(response.headers.get("Content-Type")).toBe("application/pdf");
        const buffer = Buffer.from(await response.arrayBuffer());
        expect(buffer.subarray(0, 4).toString("ascii")).toBe("%PDF");
    });

    it("generates a valid (empty-state) PDF when there are no records", async () => {
        const response = await getPaymentsReportRoute(makeRequest(`http://localhost/api/schools/${SCHOOL_EMPTY}/reports/payments?date=all&format=pdf`), makeParams(SCHOOL_EMPTY));
        expect(response.status).toBe(200);
        const buffer = Buffer.from(await response.arrayBuffer());
        expect(buffer.subarray(0, 4).toString("ascii")).toBe("%PDF");
    });
});

describe("Owing report", () => {
    it("shows the partially-paid charge on its date with correct status and balance", async () => {
        const response = await getOwingReportRoute(makeRequest(`http://localhost/api/schools/${SCHOOL_1}/reports/owing?date=${DATE_A}`), makeParams(SCHOOL_1));
        const body = await readJson(response);
        expect(body.rows).toHaveLength(1);
        expect(body.rows[0].first_name).toBe("Alice");
        expect(Number(body.rows[0].paid)).toBe(200);
        expect(Number(body.rows[0].balance)).toBe(300);
        expect(body.rows[0].status).toBe("Partially Paid");
        expect(body.total).toBe(300);
    });

    it("shows the fully-unpaid charge on its own date, including zero-payment rows", async () => {
        const response = await getOwingReportRoute(makeRequest(`http://localhost/api/schools/${SCHOOL_1}/reports/owing?date=${DATE_B}`), makeParams(SCHOOL_1));
        const body = await readJson(response);
        expect(body.rows).toHaveLength(1);
        expect(body.rows[0].first_name).toBe("Bilal");
        expect(Number(body.rows[0].paid)).toBe(0);
        expect(Number(body.rows[0].balance)).toBe(500);
        expect(body.rows[0].status).toBe("Unpaid");
        expect(body.total).toBe(500);
    });

    it("shows both outstanding charges for All Dates with combined total", async () => {
        const response = await getOwingReportRoute(makeRequest(`http://localhost/api/schools/${SCHOOL_1}/reports/owing?date=all`), makeParams(SCHOOL_1));
        const body = await readJson(response);
        expect(body.rows).toHaveLength(2);
        expect(body.total).toBe(800);
    });

    it("excludes a fully-paid charge (balance zero) from another school", async () => {
        const response = await getOwingReportRoute(makeRequest(`http://localhost/api/schools/${SCHOOL_2}/reports/owing?date=all`), makeParams(SCHOOL_2));
        const body = await readJson(response);
        expect(body.rows).toHaveLength(0);
        expect(body.total).toBe(0);
    });

    it("rejects an invalid date", async () => {
        const response = await getOwingReportRoute(makeRequest(`http://localhost/api/schools/${SCHOOL_1}/reports/owing?date=not-a-date`), makeParams(SCHOOL_1));
        expect(response.status).toBe(400);
    });

    it("generates a downloadable PDF", async () => {
        const response = await getOwingReportRoute(makeRequest(`http://localhost/api/schools/${SCHOOL_1}/reports/owing?date=all&format=pdf`), makeParams(SCHOOL_1));
        expect(response.headers.get("Content-Type")).toBe("application/pdf");
        const buffer = Buffer.from(await response.arrayBuffer());
        expect(buffer.subarray(0, 4).toString("ascii")).toBe("%PDF");
    });
});

describe("Expenses report", () => {
    it("returns only the expense on the specific date, with the correct total", async () => {
        const response = await getExpensesReportRoute(makeRequest(`http://localhost/api/schools/${SCHOOL_1}/reports/expenses?date=${DATE_A}`), makeParams(SCHOOL_1));
        const body = await readJson(response);
        expect(body.rows).toHaveLength(1);
        expect(body.rows[0].category_name).toBe("Utilities");
        expect(body.total).toBe(50);
    });

    it("returns the other expense for its own date", async () => {
        const response = await getExpensesReportRoute(makeRequest(`http://localhost/api/schools/${SCHOOL_1}/reports/expenses?date=${DATE_B}`), makeParams(SCHOOL_1));
        const body = await readJson(response);
        expect(body.rows).toHaveLength(1);
        expect(body.total).toBe(30);
    });

    it("returns both expenses and the combined total for All Dates", async () => {
        const response = await getExpensesReportRoute(makeRequest(`http://localhost/api/schools/${SCHOOL_1}/reports/expenses?date=all`), makeParams(SCHOOL_1));
        const body = await readJson(response);
        expect(body.rows).toHaveLength(2);
        expect(body.total).toBe(80);
    });

    it("matches a direct PostgreSQL SUM for the same filter", async () => {
        const response = await getExpensesReportRoute(makeRequest(`http://localhost/api/schools/${SCHOOL_1}/reports/expenses?date=all`), makeParams(SCHOOL_1));
        const body = await readJson(response);
        const dbResult = await query(
            `SELECT COALESCE(SUM(e.amount), 0) AS total FROM expenses e
             JOIN expense_categories ec ON ec.expense_category_id = e.expense_category_id
             WHERE ec.school_id = $1`,
            [SCHOOL_1]
        );
        expect(body.total).toBe(Number(dbResult.rows[0].total));
    });

    it("rejects an invalid date", async () => {
        const response = await getExpensesReportRoute(makeRequest(`http://localhost/api/schools/${SCHOOL_1}/reports/expenses?date=2026-02-30`), makeParams(SCHOOL_1));
        expect(response.status).toBe(400);
    });

    it("generates a downloadable PDF", async () => {
        const response = await getExpensesReportRoute(makeRequest(`http://localhost/api/schools/${SCHOOL_1}/reports/expenses?date=all&format=pdf`), makeParams(SCHOOL_1));
        expect(response.headers.get("Content-Type")).toBe("application/pdf");
        const buffer = Buffer.from(await response.arrayBuffer());
        expect(buffer.subarray(0, 4).toString("ascii")).toBe("%PDF");
    });
});

describe("Report summary", () => {
    it("computes correct totals for a specific date", async () => {
        const response = await getSummaryRoute(makeRequest(`http://localhost/api/schools/${SCHOOL_1}/reports/summary?date=${DATE_A}`), makeParams(SCHOOL_1));
        const body = await readJson(response);
        expect(body.totalPayments).toBe(200);
        expect(body.totalOutstanding).toBe(300);
        expect(body.totalExpenses).toBe(50);
        expect(body.netPosition).toBe(150);
    });

    it("computes correct totals for All Dates", async () => {
        const response = await getSummaryRoute(makeRequest(`http://localhost/api/schools/${SCHOOL_1}/reports/summary?date=all`), makeParams(SCHOOL_1));
        const body = await readJson(response);
        expect(body.totalPayments).toBe(200);
        expect(body.totalOutstanding).toBe(800);
        expect(body.totalExpenses).toBe(80);
        expect(body.netPosition).toBe(120);
    });

    it("rejects an invalid date", async () => {
        const response = await getSummaryRoute(makeRequest(`http://localhost/api/schools/${SCHOOL_1}/reports/summary?date=banana`), makeParams(SCHOOL_1));
        expect(response.status).toBe(400);
    });
});
