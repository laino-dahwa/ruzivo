import { query } from "../../../lib/db";

export async function deleteSchool(school_id:string) {
    const result = await query(`
        DELETE FROM schools
        WHERE school_id = $1
        RETURNING *`,
        [school_id]
    );

    return result.rows;
}
