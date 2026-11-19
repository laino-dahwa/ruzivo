import { query } from "../../lib/db";
import { REPORT_TIMEZONE } from "../../lib/reportTimezone";
import { dateWindow, periodFilter, scopeParams, timestampWindow, type ReportScope } from "../../lib/reports/scope";
import { PAID_TOWARD_FEE } from "../payment/read/paidTowardFee";

export type ReportSummary = {
    totalPayments: number;
    totalOutstanding: number;
    totalExpenses: number;
    netPosition: number;
};

/**
 * `expenseScope` is separate because expenses carry no payment period: a
 * period-scoped report filters payments and owing by the period itself, and
 * expenses by the calendar window that period names. Applying one window to
 * both would drop a payment billed to January but taken in March.
 */
export async function getReportSummary(
    school_id: string,
    scope: ReportScope,
    expenseScope: ReportScope = scope,
): Promise<ReportSummary> {
    const params = [...scopeParams(school_id, scope), REPORT_TIMEZONE];

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
              AND ${timestampWindow("p.paid_at")}
              AND ${periodFilter()}
        ) AS distinct_payments
        `,
        params
    );

    const owingResult = await query(
        `
        -- Every accepted fee not yet paid in full: the same rows as
        -- getOwingReport and the Balances page (getBalances).
        WITH owing AS (
            SELECT
                COALESCE(fd.amount, ic.income_limit) - COALESCE(paid.total, 0) AS balance
            FROM fee_decisions fd
            JOIN income_categories ic ON ic.income_category_id = fd.income_category_id
            ${PAID_TOWARD_FEE}
            WHERE fd.school_id = $1
              AND fd.decision = 'ACCEPTED'
              AND ${timestampWindow("fd.decided_at")}
              AND ${periodFilter("fd.payment_period_id")}
              AND COALESCE(fd.amount, ic.income_limit) - COALESCE(paid.total, 0) > 0
        )
        SELECT COALESCE(SUM(balance), 0) AS total FROM owing
        `,
        params
    );

    // Expenses carry no payment period, so only the date bounds apply — a
    // period-scoped report converts its period to a calendar window first.
    const expensesResult = await query(
        `
        SELECT COALESCE(SUM(e.amount), 0) AS total
        FROM expenses e
        JOIN expense_categories ec ON ec.expense_category_id = e.expense_category_id
        WHERE ec.school_id = $1
          AND ${dateWindow("e.expense_date")}
        `,
        [school_id, expenseScope.start, expenseScope.end]
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
