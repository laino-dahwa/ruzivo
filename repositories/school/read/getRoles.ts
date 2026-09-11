import { query } from "../../../lib/db";

export async function getRoles(school_id: string) {
    const result = await query(`
        SELECT *
        FROM roles
        WHERE school_id = $1
        ORDER BY role_name`,
        [school_id]
    );

    return result.rows;
}
