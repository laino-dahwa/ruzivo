import { afterAll, describe, expect, it } from "vitest";
import { createSchool } from "../repositories/school/create/createSchool";
import { createGender } from "../repositories/school/create/createGenderCategory";
import { createClassCategory } from "../repositories/school/create/createClassCategory";
import { createAcademicYear } from "../repositories/school/create/createAcademicYear";
import { createIncomeCategory } from "../repositories/school/create/createIncomeCategory";
import { createPaymentPeriod } from "../repositories/school/create/createPaymentPeriod";
import { createPaymentMethod } from "../repositories/school/create/createPaymentMethod";
import { createExpenseCategory } from "../repositories/school/create/createExpenseCategory";
import { createLearners } from "../repositories/learner/create/addLearner";
import { createChargesWithPayments } from "../repositories/payment/create/createNewPayment";
import { deleteSchool } from "../repositories/school/delete/deteleSchool";
import { query } from "../lib/db";

// deleteSchool() had no test at all, and every other suite hand-deletes its
// children before removing its test school — which is precisely why nobody
// noticed that deleting a school with real data failed outright: learners,
// charges and payments all hang off non-cascading foreign keys.
const SCHOOL = "TSD";
const NEIGHBOUR = "TSN";

afterAll(async () => {
  // Belt and braces: if an assertion failed partway, leave nothing behind.
  for (const school of [SCHOOL, NEIGHBOUR, "TSE"]) {
    await query(`DELETE FROM payment_allocations WHERE charge_id IN (SELECT charge_id FROM charges WHERE learner_id IN (SELECT learner_id FROM learners WHERE school_id = $1))`, [school]);
    await query(`DELETE FROM charges WHERE learner_id IN (SELECT learner_id FROM learners WHERE school_id = $1)`, [school]);
    await query(`DELETE FROM enrolments WHERE learner_id IN (SELECT learner_id FROM learners WHERE school_id = $1)`, [school]);
    await query(`DELETE FROM payments WHERE payment_method_id IN (SELECT payment_method_id FROM payment_methods WHERE school_id = $1)`, [school]);
    await query(`DELETE FROM learners WHERE school_id = $1`, [school]);
    await query(`DELETE FROM schools WHERE school_id = $1`, [school]);
  }
});

describe("deleteSchool", () => {
  it("removes a school that has learners, charges and recorded payments", async () => {
    await createSchool([{ school_id: SCHOOL, school_name: "Delete Me", school_type: "primary", school_address: "n/a", school_contact: "n/a", school_email: "del@test.local" }]);

    const [gender] = await createGender([{ school_id: SCHOOL, gender_name: "Test Gender D" }]);
    const [classCategory] = await createClassCategory([{ school_id: SCHOOL, class_name: "Test Class D" }]);
    const [year] = await createAcademicYear([{ school_id: SCHOOL, academic_year_name: "Test Year D", start_date: "2026-01-01", end_date: "2026-12-31" }]);
    const [fee] = await createIncomeCategory([{ school_id: SCHOOL, income_name: "Test Fee D", income_limit: "1000" }]);
    const [period] = await createPaymentPeriod([{ school_id: SCHOOL, period_name: "Test Term D" }]);
    const [method] = await createPaymentMethod([{ school_id: SCHOOL, method_name: "Test Cash D" }]);
    await createExpenseCategory([{ school_id: SCHOOL, expense_name: "Test Expense D" }]);

    const [learner] = await createLearners([{
      school_id: SCHOOL,
      first_name: "Gone",
      last_name: "Soon",
      gender_id: gender.gender_id,
      date_of_birth: "2015-01-01",
      class_category_id: classCategory.class_category_id,
      academic_year_id: year.academic_year_id,
    }]);

    const enrolment = await query("SELECT enrolment_id FROM enrolments WHERE learner_id = $1", [learner.learner_id]);

    await createChargesWithPayments({
      learner_id: learner.learner_id,
      enrolment_id: Number(enrolment.rows[0].enrolment_id),
      payment_period_id: Number(period.payment_period_id),
      academic_year_id: Number(year.academic_year_id),
      payment_method_id: Number(method.payment_method_id),
      income_categories: [{ income_category_id: Number(fee.income_category_id), amount: 100 }],
    });

    // Before the fix this rejected with "violates foreign key constraint".
    const deleted = await deleteSchool(SCHOOL);
    expect(deleted).toHaveLength(1);
    expect(deleted[0].school_id.trim()).toBe(SCHOOL);

    const leftovers = await query(
      `
      SELECT
        (SELECT count(*) FROM schools           WHERE school_id = $1)                                                      +
        (SELECT count(*) FROM learners          WHERE school_id = $1)                                                      +
        (SELECT count(*) FROM genders           WHERE school_id = $1)                                                      +
        (SELECT count(*) FROM class_categories  WHERE school_id = $1)                                                      +
        (SELECT count(*) FROM payment_periods   WHERE school_id = $1)                                                      +
        (SELECT count(*) FROM payment_methods   WHERE school_id = $1)                                                      +
        (SELECT count(*) FROM income_categories WHERE school_id = $1)                                                      +
        (SELECT count(*) FROM academic_years    WHERE school_id = $1)                                                      +
        (SELECT count(*) FROM expense_categories WHERE school_id = $1)                                                     +
        (SELECT count(*) FROM charges  c JOIN learners l ON l.learner_id = c.learner_id WHERE l.school_id = $1)            +
        (SELECT count(*) FROM enrolments e JOIN learners l ON l.learner_id = e.learner_id WHERE l.school_id = $1)
        AS total
      `,
      [SCHOOL]
    );
    expect(Number(leftovers.rows[0].total)).toBe(0);
  });

  it("leaves a neighbouring school's learners and payments untouched", async () => {
    await createSchool([{ school_id: NEIGHBOUR, school_name: "Keep Me", school_type: "primary", school_address: "n/a", school_contact: "n/a", school_email: "keep@test.local" }]);

    const [gender] = await createGender([{ school_id: NEIGHBOUR, gender_name: "Test Gender N" }]);
    const [classCategory] = await createClassCategory([{ school_id: NEIGHBOUR, class_name: "Test Class N" }]);
    const [year] = await createAcademicYear([{ school_id: NEIGHBOUR, academic_year_name: "Test Year N", start_date: "2026-01-01", end_date: "2026-12-31" }]);
    const [fee] = await createIncomeCategory([{ school_id: NEIGHBOUR, income_name: "Test Fee N", income_limit: "1000" }]);
    const [period] = await createPaymentPeriod([{ school_id: NEIGHBOUR, period_name: "Test Term N" }]);
    const [method] = await createPaymentMethod([{ school_id: NEIGHBOUR, method_name: "Test Cash N" }]);

    const [learner] = await createLearners([{
      school_id: NEIGHBOUR,
      first_name: "Stays",
      last_name: "Put",
      gender_id: gender.gender_id,
      date_of_birth: "2015-01-01",
      class_category_id: classCategory.class_category_id,
      academic_year_id: year.academic_year_id,
    }]);
    const enrolment = await query("SELECT enrolment_id FROM enrolments WHERE learner_id = $1", [learner.learner_id]);
    await createChargesWithPayments({
      learner_id: learner.learner_id,
      enrolment_id: Number(enrolment.rows[0].enrolment_id),
      payment_period_id: Number(period.payment_period_id),
      academic_year_id: Number(year.academic_year_id),
      payment_method_id: Number(method.payment_method_id),
      income_categories: [{ income_category_id: Number(fee.income_category_id), amount: 100 }],
    });

    // A second school built exactly like the one being deleted, so a sweep
    // that forgot its school_id filter would take this one with it.
    const doomed = "TSE";
    await createSchool([{ school_id: doomed, school_name: "Also Delete Me", school_type: "primary", school_address: "n/a", school_contact: "n/a", school_email: "del2@test.local" }]);
    await deleteSchool(doomed);

    const survivors = await query(
      `
      SELECT
        (SELECT count(*) FROM learners WHERE school_id = $1) AS learners,
        (SELECT count(*) FROM charges c JOIN learners l ON l.learner_id = c.learner_id WHERE l.school_id = $1) AS charges,
        (SELECT count(*) FROM payments p JOIN payment_allocations pa ON pa.payment_id = p.payment_id
           JOIN charges c ON c.charge_id = pa.charge_id JOIN learners l ON l.learner_id = c.learner_id
          WHERE l.school_id = $1) AS payments
      `,
      [NEIGHBOUR]
    );
    expect(Number(survivors.rows[0].learners)).toBe(1);
    expect(Number(survivors.rows[0].charges)).toBe(1);
    expect(Number(survivors.rows[0].payments)).toBe(1);
  });
});
