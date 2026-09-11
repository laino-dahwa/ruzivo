import { query } from "../../../lib/db";
import { getschool } from "../read/getSchool";
import { getEmployees } from "../../employee/read/getEmployees";
import { getPaymentsReport } from "../../report/getPaymentsReport";
import { getExpensesReport } from "../../report/getExpensesReport";
import { ALL_DATES } from "../../../lib/reports/scope";
import type { ExportSheet } from "../../../lib/excel/workbook";

/**
 * Everything the app holds for one school, one sheet per table (or, for
 * payments/expenses, the same joined shape the Reports section already
 * shows — reused rather than re-derived, scoped to all dates so the export
 * is the school's whole history).
 *
 * Never includes `password_hash` — getEmployees already leaves it out.
 */
export async function getSchoolExportData(school_id: string): Promise<ExportSheet[]> {
  const [
    school,
    employees,
    roles,
    learners,
    genders,
    classCategories,
    academicYears,
    paymentPeriods,
    paymentMethods,
    incomeCategories,
    expenseCategories,
    enrolments,
    charges,
    payments,
    expenses,
  ] = await Promise.all([
    getschool(school_id),
    getEmployees(school_id),
    query(`SELECT role_id, role_name FROM roles WHERE school_id = $1 ORDER BY role_name`, [school_id]).then((r) => r.rows),
    query(
      `
      SELECT l.learner_id, l.first_name, l.last_name, l.email, g.gender_name,
             TO_CHAR(l.date_of_birth, 'YYYY-MM-DD') AS date_of_birth, l.created_at
      FROM learners l
      LEFT JOIN genders g ON g.gender_id = l.gender_id
      WHERE l.school_id = $1 AND l.deleted_at IS NULL
      ORDER BY l.last_name, l.first_name
      `,
      [school_id]
    ).then((r) => r.rows),
    query(`SELECT gender_id, gender_name FROM genders WHERE school_id = $1 ORDER BY gender_name`, [school_id]).then((r) => r.rows),
    query(`SELECT class_category_id, class_name FROM class_categories WHERE school_id = $1 ORDER BY class_name`, [school_id]).then((r) => r.rows),
    query(
      `SELECT academic_year_id, academic_year_name, start_date::text, end_date::text FROM academic_years WHERE school_id = $1 ORDER BY start_date`,
      [school_id]
    ).then((r) => r.rows),
    query(`SELECT payment_period_id, period_name FROM payment_periods WHERE school_id = $1 ORDER BY period_name`, [school_id]).then((r) => r.rows),
    query(`SELECT payment_method_id, method_name FROM payment_methods WHERE school_id = $1 ORDER BY method_name`, [school_id]).then((r) => r.rows),
    query(
      `SELECT income_category_id, income_name, income_limit FROM income_categories WHERE school_id = $1 ORDER BY income_name`,
      [school_id]
    ).then((r) => r.rows),
    query(`SELECT expense_category_id, expense_name FROM expense_categories WHERE school_id = $1 ORDER BY expense_name`, [school_id]).then((r) => r.rows),
    query(
      `
      SELECT l.learner_id, l.first_name, l.last_name, cc.class_name, ay.academic_year_name
      FROM enrolments e
      JOIN learners l ON l.learner_id = e.learner_id
      JOIN class_categories cc ON cc.class_category_id = e.class_category_id
      JOIN academic_years ay ON ay.academic_year_id = e.academic_year_id
      WHERE l.school_id = $1
      ORDER BY ay.academic_year_name, cc.class_name, l.last_name
      `,
      [school_id]
    ).then((r) => r.rows),
    query(
      `
      SELECT c.charge_id, l.learner_id, l.first_name, l.last_name,
             ic.income_name, pp.period_name, ay.academic_year_name, c.created_at
      FROM charges c
      JOIN learners l ON l.learner_id = c.learner_id
      JOIN income_categories ic ON ic.income_category_id = c.income_category_id
      JOIN payment_periods pp ON pp.payment_period_id = c.payment_period_id
      JOIN academic_years ay ON ay.academic_year_id = c.academic_year_id
      WHERE l.school_id = $1
      ORDER BY c.created_at
      `,
      [school_id]
    ).then((r) => r.rows),
    getPaymentsReport(school_id, ALL_DATES),
    getExpensesReport(school_id, ALL_DATES),
  ]);

  return [
    { name: "School", rows: school },
    { name: "Roles", rows: roles },
    { name: "Employees", rows: employees },
    { name: "Learners", rows: learners },
    { name: "Enrolments", rows: enrolments },
    { name: "Genders", rows: genders },
    { name: "Class Categories", rows: classCategories },
    { name: "Academic Years", rows: academicYears },
    { name: "Payment Periods", rows: paymentPeriods },
    { name: "Payment Methods", rows: paymentMethods },
    { name: "Income Categories", rows: incomeCategories },
    { name: "Expense Categories", rows: expenseCategories },
    { name: "Charges", rows: charges },
    { name: "Payments", rows: payments.rows },
    { name: "Expenses", rows: expenses.rows },
  ];
}
