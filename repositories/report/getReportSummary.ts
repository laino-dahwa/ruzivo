import { query } from "../../lib/db";
import { REPORT_TIMEZONE } from "../../lib/reportTimezone";

export type ReportSummary = {
    totalPayments: number;
    totalOutstanding: number;
    totalExpenses: number;
    netPosition: number;
};

export async function getReportSummary(school_id: string, report_date: string | null): Promise<ReportSummary> {
    const paymentsResult = await query(
        `
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM (
            SELECT DISTINCT p.payment_id, p.amount
            FROM payments p
            JOIN payment_allocations pa ON pa.payment_id = p.payment_id
            JOIN charges c ON c.charge_id = pa.charge_id
            JOIN learners l ON l.learner_id = c.learner_id
            WHERE l.school_id = $1
              AND ($2::date IS NULL OR (p.paid_at AT TIME ZONE $3)::date = $2::date)
        ) AS distinct_payments
        `,
        [school_id, report_date, REPORT_TIMEZONE]
    );

    const owingResult = await query(
        `
        -- Grouped by the fee (learner + income category + period + year), not
        -- by charge row: each payment creates its own charge, so grouping by
        -- charge_id counted a part-paid fee once per instalment. Matches
        -- getOwingReport and getBalances.
        WITH owing AS (
            SELECT
                ic.income_limit - COALESCE(SUM(p.amount), 0) AS balance
            FROM learners l
            JOIN charges c ON c.learner_id = l.learner_id
            JOIN income_categories ic ON ic.income_category_id = c.income_category_id
            LEFT JOIN payment_allocations pa ON pa.charge_id = c.charge_id
            LEFT JOIN payments p ON p.payment_id = pa.payment_id
            WHERE l.school_id = $1
              AND ($2::date IS NULL OR (c.created_at AT TIME ZONE $3)::date = $2::date)
            GROUP BY l.learner_id, ic.income_category_id, ic.income_limit,
                     c.payment_period_id, c.academic_year_id
            HAVING ic.income_limit - COALESCE(SUM(p.amount), 0) > 0
        )
        SELECT COALESCE(SUM(balance), 0) AS total FROM owing
        `,
        [school_id, report_date, REPORT_TIMEZONE]
    );

    const expensesResult = await query(
        `
        SELECT COALESCE(SUM(e.amount), 0) AS total
        FROM expenses e
        JOIN expense_categories ec ON ec.expense_category_id = e.expense_category_id
        WHERE ec.school_id = $1
          AND ($2::date IS NULL OR e.expense_date = $2::date)
        `,
        [school_id, report_date]
    );

    const totalPayments = Number(paymentsResult.rows[0]?.total ?? 0);
    const totalOutstanding = Number(owingResult.rows[0]?.total ?? 0);
    const totalExpenses = Number(expensesResult.rows[0]?.total ?? 0);

    return {
        totalPayments,
        totalOutstanding,
        totalExpenses,
        netPosition: totalPayments - totalExpenses,
    };
}
