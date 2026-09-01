import { query } from "../../../lib/db";

export async function deleteExpense(school_id: string, expense_id: number) {
    const result = await query(
        `
        DELETE FROM expenses e
        USING expense_categories ec
        WHERE e.expense_id = $1
          AND e.expense_category_id = ec.expense_category_id
          AND ec.school_id = $2
        RETURNING e.*
        `,
        [expense_id, school_id]
    );

    if (result.rowCount === 0) {
        throw new Error("Expense not found.");
    }

    return result.rows[0];
}
