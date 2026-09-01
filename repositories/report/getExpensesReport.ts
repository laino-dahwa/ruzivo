import { query } from "../../lib/db";

export type ExpenseReportRow = {
    expense_id: number;
    expense_date: string;
    description: string;
    category_name: string;
    amount: string;
};

export async function getExpensesReport(school_id: string, report_date: string | null) {
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
        WHERE ec.school_id = $1
          AND ($2::date IS NULL OR e.expense_date = $2::date)
        ORDER BY e.expense_date ASC
        `,
        [school_id, report_date]
    );

    const totalResult = await query(
        `
        SELECT COALESCE(SUM(e.amount), 0) AS total
        FROM expenses e
        JOIN expense_categories ec ON ec.expense_category_id = e.expense_category_id
        WHERE ec.school_id = $1
          AND ($2::date IS NULL OR e.expense_date = $2::date)
        `,
        [school_id, report_date]
    );

    return {
        rows: rowsResult.rows as ExpenseReportRow[],
        total: Number(totalResult.rows[0]?.total ?? 0),
    };
}
