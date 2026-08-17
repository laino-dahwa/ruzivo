import { transaction } from "../../../lib/db";

type UpdateLearner = {
  learner_id: string;
  enrolment_id: number;

  first_name?: string;
  last_name?: string;
  gender_id?: number;
  date_of_birth?: string;

  class_category_id?: number;
  academic_year_id?: number;
};

export async function updateLearners(
  learners: UpdateLearner[]
) {
  if (learners.length === 0) {
    return [];
  }

  const values: unknown[] = [];

  const placeholders = learners.map(
    (learner, index) => {
      const offset = index * 7;

      values.push(
        learner.learner_id,
        learner.enrolment_id,
        learner.first_name ?? null,
        learner.last_name ?? null,
        learner.gender_id ?? null,
        learner.date_of_birth ?? null,
        learner.class_category_id ?? null,
        learner.academic_year_id ?? null
      );

      return `(
        $${offset + 1},
        $${offset + 2},
        $${offset + 3},
        $${offset + 4},
        $${offset + 5},
        $${offset + 6},
        $${offset + 7},
        $${offset + 8}
      )`;
    }
  );

  return transaction(async (client) => {

    // --------------------------------
    // 1. UPDATE LEARNERS
    // --------------------------------

    const learnerResult = await client.query(
      `
      UPDATE learners AS l
      SET
        first_name = COALESCE(
          v.first_name,
          l.first_name
        ),

        last_name = COALESCE(
          v.last_name,
          l.last_name
        ),

        gender_id = COALESCE(
          v.gender_id,
          l.gender_id
        ),

        date_of_birth = COALESCE(
          v.date_of_birth,
          l.date_of_birth
        )

      FROM (
        VALUES
          ${placeholders.join(",")}
      ) AS v(
        learner_id,
        enrolment_id,
        first_name,
        last_name,
        gender_id,
        date_of_birth,
        class_category_id,
        academic_year_id
      )

      WHERE l.learner_id = v.learner_id

      RETURNING
        l.learner_id,
        l.school_id,
        l.first_name,
        l.last_name,
        l.gender_id,
        l.date_of_birth
      `,
      values
    );


    // --------------------------------
    // 2. UPDATE ENROLMENTS
    // --------------------------------

    const enrolmentResult = await client.query(
      `
      UPDATE enrolments AS e
      SET
        class_category_id = COALESCE(
          v.class_category_id,
          e.class_category_id
        ),

        academic_year_id = COALESCE(
          v.academic_year_id,
          e.academic_year_id
        )

      FROM (
        VALUES
          ${placeholders.join(",")}
      ) AS v(
        learner_id,
        enrolment_id,
        first_name,
        last_name,
        gender_id,
        date_of_birth,
        class_category_id,
        academic_year_id
      )

      WHERE e.enrolment_id = v.enrolment_id
        AND e.learner_id = v.learner_id

      RETURNING
        e.enrolment_id,
        e.learner_id,
        e.class_category_id,
        e.academic_year_id
      `,
      values
    );


    // --------------------------------
    // 3. RETURN BOTH RESULTS
    // --------------------------------

    return {
      learners: learnerResult.rows,
      enrolments: enrolmentResult.rows,
    };
  });
}