import { query } from "../../../lib/db";

export async function getLearners(learner_id:string|null,class_name:string|null,gender_name:string|null,academic_year:string|null) {
    const result = await query(`
        SELECT l.learner_id, l.first_name, l.last_name, g.gender_name, ay.academic_year_name AS curent_year , ca.class_name, e.enrolment_id
        FROM enrolments e 
        JOIN learners l 
        ON l.learner_id = e.learner_id
        JOIN genders g
        ON g.gender_id = l.gender_id
        JOIN academic_years ay 
        ON ay.academic_year_id= e.academic_year_id
        JOIN class_categories ca 
        ON ca.class_category_id = e.class_category_id
        WHERE 
        ($1::text IS NULL OR l.learner_id= $1::text)
         AND
        ($2::text IS NULL OR ca.class_name= $2::text)
         AND
        ($3::text IS NULL OR g.gender_name= $3::text)
         AND
        ($4::text IS NULL OR ay.academic_year_name= $4::text)
        `,
        [learner_id,class_name, gender_name, academic_year]
    );
    return result.rows;
}
