import { query } from "../../../lib/db";

export async function getAcademicYears(school_id:string) {
    const result = await query(`
        SELECT *
        FROM academic_years
        WHERE school_id =$1`,
        [school_id]
    );

    return result.rows;
}
