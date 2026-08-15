import { query } from "../../../lib/db";

export async function getGender(school_id:string) {
    const result = await query(`
        SELECT *
        FROM genders
        WHERE school_id =$1`,
        [school_id]
    );

    return result.rows;
}
