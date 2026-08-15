import { query } from "../../../lib/db";

export async function getExpenseCategories(school_id:string) {
    const result = await query(`
        SELECT *
        FROM expense_categories
        WHERE school_id =$1`,
        [school_id]
    );

    return result.rows;
}
