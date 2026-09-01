import { query } from "../../../lib/db";

export async function getExpense(school_id:string) {
    const result = await query(`
        SELECT e.*
        FROM expenses e
        JOIN expense_categories ec ON ec.expense_category_id = e.expense_category_id
        WHERE ec.school_id = $1`,
        [school_id]
    );

    return result.rows;
}
