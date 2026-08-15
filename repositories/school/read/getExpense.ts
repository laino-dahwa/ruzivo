import { query } from "../../../lib/db";

export async function getExpense(school_id:string) {
    const result = await query(`
        SELECT *
        FROM expenses
        WHERE school_id =$1`,
        [school_id]
    );

    return result.rows;
}
