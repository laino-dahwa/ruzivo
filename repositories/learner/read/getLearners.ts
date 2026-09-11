import { query } from "../../../lib/db";

export async function getLearners(learner_id:string|null,class_name:string|null,gender_name:string|null,academic_year:string|null) {
    const result = await query(`
        SELECT l.learner_id, l.first_name, l.last_name, l.email,
               l.gender_id::int AS gender_id, g.gender_name,
               -- date_of_birth is a DATE. Read back as a JS Date it picks up
               -- the server's timezone offset and can render as the previous
               -- day, so it is formatted in SQL and travels as a plain
               -- YYYY-MM-DD string the edit form can use directly.
               TO_CHAR(l.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
               e.academic_year_id::int AS academic_year_id, ay.academic_year_name AS curent_year,
               e.class_category_id::int AS class_category_id, ca.class_name,
               e.enrolment_id::int AS enrolment_id
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
        l.deleted_at IS NULL
         AND
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
