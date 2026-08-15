import { query } from "../../../lib/db";

export async function getPaymentMethods(school_id:string) {
    const result = await query(`
        SELECT *
        FROM payment_methods
        WHERE school_id =$1`,
        [school_id]
    );

    return result.rows;
}
