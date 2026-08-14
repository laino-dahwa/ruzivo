import { query } from "../../../lib/db";

export async function getAcademicYears(request) {
    const result = await query(`
        SELECT *
        FROM academic_years
        WHERE school_id =$1`,
        [request]
    );

    return result.rows;
}
