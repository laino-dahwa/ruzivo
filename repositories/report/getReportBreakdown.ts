import { query } from "../../lib/db";
import { REPORT_TIMEZONE } from "../../lib/reportTimezone";
import { dateWindow, periodFilter, scopeParams, timestampWindow, type ReportScope } from "../../lib/reports/scope";

export type CategoryTotal = { name: string; total: number };
export type DailyTotal = { date: string; income: number; expenses: number };

export type ReportBreakdown = {
    incomeByCategory: CategoryTotal[];
    expensesByCategory: CategoryTotal[];
    daily: DailyTotal[];
};

/**
 * The figures behind the report's charts: where the money came from, where it
 * went, and how both moved across the window.
 *
 * Kept apart from the row-level reports because these are aggregates the tables
 * cannot supply — a payment allocated across several charges appears once per
 * allocation in the payments table, so summing that table would double-count.
 */
export async function getReportBreakdown(
    school_id: string,
    scope: ReportScope,
    // Separate for the same reason as getReportSummary: expenses have no
    // payment period, so a period report dates them instead.
    expenseScope: ReportScope = scope,
): Promise<ReportBreakdown> {
    const params = [...scopeParams(school_id, scope), REPORT_TIMEZONE];
    const expenseParams = [school_id, expenseScope.start, expenseScope.end];

    const incomeResult = await query(
        `
        SELECT ic.income_name AS name, COALESCE(SUM(p.amount), 0) AS total
        FROM payments p
        JOIN payment_allocations pa ON pa.payment_id = p.payment_id
        JOIN charges c ON c.charge_id = pa.charge_id
        JOIN learners l ON l.learner_id = c.learner_id
        JOIN income_categories ic ON ic.income_category_id = c.income_category_id
        WHERE l.school_id = $1
          AND ${timestampWindow("p.paid_at")}
          AND ${periodFilter()}
        GROUP BY ic.income_category_id, ic.income_name
        HAVING COALESCE(SUM(p.amount), 0) > 0
        ORDER BY total DESC
        `,
        params
    );

    const expenseResult = await query(
        `
        SELECT ec.expense_name AS name, COALESCE(SUM(e.amount), 0) AS total
        FROM expenses e
        JOIN expense_categories ec ON ec.expense_category_id = e.expense_category_id
        WHERE ec.school_id = $1
          AND ${dateWindow("e.expense_date")}
        GROUP BY ec.expense_category_id, ec.expense_name
        HAVING COALESCE(SUM(e.amount), 0) > 0
        ORDER BY total DESC
        `,
        expenseParams
    );

    // Income and expenses are summed separately and then stitched together by
    // date: a day can have one without the other, and a full outer join in SQL
    // would still need the same coalescing afterwards.
    const dailyIncomeResult = await query(
        `
        SELECT (p.paid_at AT TIME ZONE $5)::date::text AS date, COALESCE(SUM(amount), 0) AS total
        FROM (
            SELECT DISTINCT p2.payment_id, p2.amount, p2.paid_at
            FROM payments p2
            JOIN payment_allocations pa ON pa.payment_id = p2.payment_id
            JOIN charges c ON c.charge_id = pa.charge_id
            JOIN learners l ON l.learner_id = c.learner_id
            WHERE l.school_id = $1
              AND ${timestampWindow("p2.paid_at")}
              AND ${periodFilter()}
        ) AS p
        GROUP BY (p.paid_at AT TIME ZONE $5)::date
        ORDER BY 1
        `,
        params
    );

    const dailyExpenseResult = await query(
        `
        SELECT e.expense_date::text AS date, COALESCE(SUM(e.amount), 0) AS total
        FROM expenses e
        JOIN expense_categories ec ON ec.expense_category_id = e.expense_category_id
        WHERE ec.school_id = $1
          AND ${dateWindow("e.expense_date")}
        GROUP BY e.expense_date
        ORDER BY 1
        `,
        expenseParams
    );

    const byDate = new Map<string, DailyTotal>();
    for (const row of dailyIncomeResult.rows) {
        byDate.set(row.date, { date: row.date, income: Number(row.total), expenses: 0 });
    }
    for (const row of dailyExpenseResult.rows) {
        const existing = byDate.get(row.date);
        if (existing) existing.expenses = Number(row.total);
        else byDate.set(row.date, { date: row.date, income: 0, expenses: Number(row.total) });
    }

    const toCategory = (rows: { name: string; total: string }[]): CategoryTotal[] =>
        rows.map((row) => ({ name: row.name, total: Number(row.total) }));

    return {
        incomeByCategory: toCategory(incomeResult.rows as { name: string; total: string }[]),
        expensesByCategory: toCategory(expenseResult.rows as { name: string; total: string }[]),
        daily: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    };
}
