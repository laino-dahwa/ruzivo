import { query } from "../../../lib/db";

export async function getBalances(learner_id:string|null,class_name:string|null,gender_name:string|null,academic_year:string|null,income_name:string|null,payment_period:string|null) {
    const result = await query(`
        SELECT
            l.learner_id,
            l.first_name,
            l.last_name,
            ic.income_name,
            ic.income_limit AS charged,
            COALESCE(SUM(p.amount), 0) AS paid,
            ic.income_limit - COALESCE(SUM(p.amount), 0) AS balance,
            pp.period_name,
            ay.name
        FROM learners l 
        JOIN charges c
        ON l.learner_id = c.learner_id
        JOIN enrolments e 
        ON e.enrolment_id = c.enrolment_id
        JOIN class_categories ca
        ON ca.class_category_id = e.class_category_id
        JOIN income_categories ic
        ON ic.income_category_id = c.income_category_id
        JOIN payment_periods pp
        ON pp.payment_period_id = c.payment_period_id
        JOIN academic_years ay
        ON ay.academic_year_id = c.academic_year_id
        JOIN payment_allocations pa
        ON pa.charge_id = c.charge_id
        JOIN payments p 
        ON p.payment_id = pa.payment_id
        JOIN genders g 
        ON g.gender_id = l.gender_id
        WHERE
        ($1::text IS NULL OR l.learner_id= $1::text)
         AND
        ($2::text IS NULL OR ca.class_name= $2::text)
         AND
        ($3::text IS NULL OR g.gender_name= $3::text)
         AND
        ($4::text IS NULL OR ay.name= $4::text)
        AND
        ($5::text IS NULL OR ic.income_name= $5::text)
        AND
        ($6::text IS NULL OR pp.period_name= $6::text)
        GROUP BY
            l.learner_id,
            ic.income_name,
            ic.income_limit,
            pp.period_name,
            ay.name
        
        `,
        [learner_id,class_name, gender_name, academic_year,income_name,payment_period]
    );
    return result.rows;
}
