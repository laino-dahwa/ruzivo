import { query, transaction } from "../../lib/db";
import { logAuditWithin } from "../audit/writeAuditLog";
import { periodLabel } from "../../lib/payroll/compute";

export class PayrollError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayrollError";
  }
}

export type RunPayrollInput = {
  school_id: string;
  period_year: number;
  period_month: number;
  generated_by_employee_id: number | null;
  generated_by_label: string;
};

/** The expense category payroll posts to, created on first use. */
const SALARY_CATEGORY = "Salaries";

/**
 * Salaries land on the last day of the month they are for, not the day the
 * PDF happened to be generated. Running September's payroll in October must
 * still show the wage bill against September in the reports.
 */
function periodEndDate(year: number, month: number): string {
  // Day 0 of the next month is the last day of this one.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

/**
 * Runs payroll for one month, freezing what everyone is paid right now.
 *
 * Staff with no basic salary recorded are skipped rather than paid nothing —
 * an empty salary means "not entered yet", and issuing somebody a payslip
 * for zero would look deliberate.
 *
 * Re-running a month replaces its lines. Payroll for September is one fact,
 * not a pile of attempts; the audit entry records that it was re-run and by
 * whom.
 */
export async function runPayroll(input: RunPayrollInput) {
  return transaction(async (client) => {
    const eligible = await client.query(
      `
      SELECT
        e.employee_id,
        e.first_name || ' ' || e.last_name AS employee_label,
        r.role_name,
        e.email,
        e.basic_salary,
        e.transport_allowance,
        e.housing_allowance,
        e.paye_deduction,
        e.pension_deduction
      FROM employees e
      JOIN roles r ON r.role_id = e.role_id
      WHERE e.school_id = $1
        AND e.deleted_at IS NULL
        AND e.basic_salary IS NOT NULL
      ORDER BY e.last_name, e.first_name
      `,
      [input.school_id]
    );

    if (eligible.rowCount === 0) {
      throw new PayrollError("Nobody has a salary recorded yet, so there is nothing to generate.");
    }

    // ON CONFLICT: the month may already have been run. Updating rather than
    // inserting keeps one authoritative record per period.
    const run = await client.query(
      `
      INSERT INTO payroll_runs (school_id, period_year, period_month, generated_by_employee_id, generated_by_label)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (school_id, period_year, period_month) DO UPDATE
        SET generated_by_employee_id = EXCLUDED.generated_by_employee_id,
            generated_by_label = EXCLUDED.generated_by_label,
            generated_at = CURRENT_TIMESTAMP
      RETURNING payroll_run_id::int AS payroll_run_id, generated_at, expense_id::int AS expense_id, (xmax <> 0) AS was_rerun
      `,
      [input.school_id, input.period_year, input.period_month, input.generated_by_employee_id, input.generated_by_label]
    );

    const { payroll_run_id, generated_at, was_rerun, expense_id: existingExpenseId } = run.rows[0];

    await client.query(`DELETE FROM payroll_lines WHERE payroll_run_id = $1`, [payroll_run_id]);

    let totalGross = 0;

    for (const row of eligible.rows) {
      await client.query(
        `
        INSERT INTO payroll_lines (
          payroll_run_id, employee_id, employee_label, role_label, employee_email,
          basic_salary, transport_allowance, housing_allowance, paye_deduction, pension_deduction
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          payroll_run_id,
          row.employee_id,
          row.employee_label,
          row.role_name,
          row.email,
          row.basic_salary,
          row.transport_allowance,
          row.housing_allowance,
          row.paye_deduction,
          row.pension_deduction,
        ]
      );

      // Gross, not net: the school's payroll cost is everything it pays out,
      // including the PAYE and pension it withholds and passes on. Booking
      // only the take-home would understate the wage bill in every report.
      totalGross +=
        Number(row.basic_salary ?? 0) + Number(row.transport_allowance ?? 0) + Number(row.housing_allowance ?? 0);
    }

    // The expense category is created on first use rather than being one more
    // thing to set up before payroll can run at all.
    const category = await client.query(
      `
      INSERT INTO expense_categories (school_id, expense_name)
      VALUES ($1, $2)
      ON CONFLICT (school_id, expense_name) DO UPDATE SET expense_name = EXCLUDED.expense_name
      RETURNING expense_category_id
      `,
      [input.school_id, SALARY_CATEGORY]
    );

    const description = `Payroll for ${periodLabel(input.period_year, input.period_month)} — ${eligible.rowCount} staff`;
    const expenseDate = periodEndDate(input.period_year, input.period_month);

    // Updated in place on a re-run. Posting a second expense would double the
    // month's wage bill in the reports and the dashboard.
    const expense = existingExpenseId
      ? await client.query(
          `
          UPDATE expenses
          SET amount = $2, expense_date = $3, description = $4, recorded_by_employee_id = $5
          WHERE expense_id = $1
          RETURNING expense_id::int AS expense_id
          `,
          [existingExpenseId, totalGross, expenseDate, description, input.generated_by_employee_id]
        )
      : await client.query(
          `
          INSERT INTO expenses (expense_category_id, amount, expense_date, description, recorded_by_employee_id)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING expense_id::int AS expense_id
          `,
          [category.rows[0].expense_category_id, totalGross, expenseDate, description, input.generated_by_employee_id]
        );

    // An expense deleted by hand leaves a dangling id (the FK nulls it), so
    // the update above can match nothing — fall back to posting a fresh one.
    const expenseId =
      expense.rowCount === 0
        ? (
            await client.query(
              `
              INSERT INTO expenses (expense_category_id, amount, expense_date, description, recorded_by_employee_id)
              VALUES ($1, $2, $3, $4, $5)
              RETURNING expense_id::int AS expense_id
              `,
              [category.rows[0].expense_category_id, totalGross, expenseDate, description, input.generated_by_employee_id]
            )
          ).rows[0].expense_id
        : expense.rows[0].expense_id;

    await client.query(`UPDATE payroll_runs SET expense_id = $2 WHERE payroll_run_id = $1`, [payroll_run_id, expenseId]);

    await logAuditWithin(client, {
      employee_id: input.generated_by_employee_id,
      actor_label: input.generated_by_label,
      school_id: input.school_id,
      action: was_rerun ? "payroll.rerun" : "payroll.run",
      entity_type: "payroll_run",
      entity_id: String(payroll_run_id),
      summary: `${was_rerun ? "Re-ran" : "Ran"} payroll for ${periodLabel(input.period_year, input.period_month)} (${eligible.rowCount} staff)`,
      detail: { total_gross: totalGross, expense_id: expenseId },
    });

    return {
      payroll_run_id,
      generated_at,
      was_rerun,
      employee_count: eligible.rowCount ?? 0,
      expense_id: expenseId,
      total_gross: totalGross,
    };
  });
}

export async function listPayrollRuns(school_id: string) {
  const result = await query(
    `
    SELECT
      p.payroll_run_id::int AS payroll_run_id,
      p.period_year,
      p.period_month,
      p.generated_by_label,
      p.generated_at,
      (SELECT count(*) FROM payroll_lines l WHERE l.payroll_run_id = p.payroll_run_id)::int AS employee_count,
      (SELECT COALESCE(SUM(l.basic_salary + l.transport_allowance + l.housing_allowance), 0)
         FROM payroll_lines l WHERE l.payroll_run_id = p.payroll_run_id) AS total_gross,
      e.amount AS expense_amount
    FROM payroll_runs p
    LEFT JOIN expenses e ON e.expense_id = p.expense_id
    WHERE p.school_id = $1
    ORDER BY p.period_year DESC, p.period_month DESC
    LIMIT 60
    `,
    [school_id]
  );

  return result.rows;
}

/** One run with its frozen lines, for rendering the payslips. */
export async function getPayrollRun(school_id: string, payroll_run_id: number) {
  const run = await query(
    `
    SELECT payroll_run_id::int AS payroll_run_id, school_id, period_year, period_month, generated_by_label, generated_at
    FROM payroll_runs
    WHERE school_id = $1 AND payroll_run_id = $2
    `,
    [school_id, payroll_run_id]
  );

  if (run.rowCount === 0) {
    return null;
  }

  const lines = await query(
    `
    SELECT employee_label, role_label, employee_email,
           basic_salary, transport_allowance, housing_allowance, paye_deduction, pension_deduction
    FROM payroll_lines
    WHERE payroll_run_id = $1
    ORDER BY employee_label
    `,
    [payroll_run_id]
  );

  return { ...run.rows[0], lines: lines.rows };
}
