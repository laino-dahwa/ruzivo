import { query } from "../../../lib/db";

export async function getschool(school_id:string) {
    const result = await query(`
        SELECT *
        FROM schools
        WHERE school_id =$1`,
        [school_id]
    );

    return result.rows;
}
