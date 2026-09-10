import { query } from "../../lib/db";
import { dateWindow, type ReportScope } from "../../lib/reports/scope";

export type ExpenseReportRow = {
    expense_id: number;
    expense_date: string;
    description: string;
    category_name: string;
    amount: string;
};

// Expenses are dated but carry no payment period, so only the date bounds
// apply here. A period-scoped report converts its period to a calendar window
// before calling this — see expenseWindowForPeriod.
const WHERE = `
    ec.school_id = $1
    AND ${dateWindow("e.expense_date")}
`;

export async function getExpensesReport(school_id: string, scope: ReportScope) {
    const params = [school_id, scope.start, scope.end];

    const rowsResult = await query(
        `
        SELECT
            e.expense_id,
            e.expense_date::text AS expense_date,
            e.description,
            ec.expense_name AS category_name,
            e.amount
        FROM expenses e
        JOIN expense_categories ec ON ec.expense_category_id = e.expense_category_id
        WHERE ${WHERE}
        ORDER BY e.expense_date ASC
        `,
        params
    );

    const totalResult = await query(
        `
        SELECT COALESCE(SUM(e.amount), 0) AS total
        FROM expenses e
        JOIN expense_categories ec ON ec.expense_category_id = e.expense_category_id
        WHERE ${WHERE}
        `,
        params
    );

    return {
        rows: rowsResult.rows as ExpenseReportRow[],
        total: Number(totalResult.rows[0]?.total ?? 0),
    };
}
