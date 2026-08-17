import { randomInt } from "crypto";
import { transaction } from "../../../lib/db";

export type CreateLearnerInput = {
  school_id: string;
  first_name: string;
  last_name: string;
  gender_id: number;
  date_of_birth: string;

  class_category_id: number;
  academic_year_id: number;
};

type PreparedLearner = CreateLearnerInput & {
  learner_id: string;
};

const ALPHANUMERIC =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

const MAX_RETRIES = 5;

function generateLearnerId(schoolId: string): string {
  let suffix = "";

  for (let i = 0; i < 5; i++) {
    suffix +=
      ALPHANUMERIC[randomInt(ALPHANUMERIC.length)];
  }

  return `${schoolId}${suffix}`;
}

function prepareLearners(
  learners: CreateLearnerInput[]
): PreparedLearner[] {
  return learners.map((learner) => ({
    ...learner,
    learner_id: generateLearnerId(
      learner.school_id
    ),
  }));
}

export async function createLearners(
  learners: CreateLearnerInput[]
) {
  if (learners.length === 0) {
    return [];
  }

  for (
    let attempt = 1;
    attempt <= MAX_RETRIES;
    attempt++
  ) {
    const preparedLearners =
      prepareLearners(learners);

    try {
      return await transaction(async (client) => {

        // -----------------------------
        // 1. INSERT LEARNERS
        // -----------------------------

        const learnerValues: unknown[] = [];

        const learnerPlaceholders =
          preparedLearners.map(
            (learner, index) => {
              const offset = index * 6;

              learnerValues.push(
                learner.learner_id,
                learner.school_id,
                learner.first_name,
                learner.last_name,
                learner.gender_id,
                learner.date_of_birth
              );

              return `(
                $${offset + 1},
                $${offset + 2},
                $${offset + 3},
                $${offset + 4},
                $${offset + 5},
                $${offset + 6}
              )`;
            }
          );

        await client.query(
          `
          INSERT INTO learners (
            learner_id,
            school_id,
            first_name,
            last_name,
            gender_id,
            date_of_birth
          )
          VALUES
            ${learnerPlaceholders.join(",")}
          `,
          learnerValues
        );

        // -----------------------------
        // 2. INSERT ENROLMENTS
        // -----------------------------

        const enrolmentValues: unknown[] = [];

        const enrolmentPlaceholders =
          preparedLearners.map(
            (learner, index) => {
              const offset = index * 3;

              enrolmentValues.push(
                learner.learner_id,
                learner.class_category_id,
                learner.academic_year_id
              );

              return `(
                $${offset + 1},
                $${offset + 2},
                $${offset + 3}
              )`;
            }
          );

        await client.query(
          `
          INSERT INTO enrolments (
            learner_id,
            class_category_id,
            academic_year_id
          )
          VALUES
            ${enrolmentPlaceholders.join(",")}
          `,
          enrolmentValues
        );

        // -----------------------------
        // 3. RETURN CREATED LEARNERS
        // -----------------------------

        return preparedLearners;
      });

    } catch (error:unknown) {

      // PostgreSQL unique violation
      if (
        error instanceof Error &&
        "code" in error &&
        "constraint" in error &&
        error.code === "23505" &&
        error.constraint === "learners_pkey"
      ) {
        if (attempt === MAX_RETRIES) {
          throw new Error(
            "Unable to generate unique learner IDs after multiple attempts."
          );
        }

        // Try again with completely new IDs
        continue;
      }

      // Any other database error
      throw error;
    }
  }

  throw new Error(
    "Failed to create learners."
  );
}