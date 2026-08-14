import { query } from "../../../lib/db";

export async function getschool(request) {
    const result = await query(`
        SELECT *
        FROM schools
        WHERE school_id =$1`,
        [request]
    );

    return result.rows;
}
