import { randomInt } from "crypto";
import { query, transaction } from "../../../lib/db";
import { generateUniqueEmail } from "../../../lib/identity/email";

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
  email: string;
};

const ALPHANUMERIC =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

const MAX_RETRIES = 5;

// learner_id is VARCHAR(8) and school_id is CHAR(4), so the suffix gets the
// remaining 4 characters. A 5-character suffix overflowed the column for any
// 4-character school id (e.g. "ZZ99"), which made those schools unable to
// hold learners at all. 36^4 combinations per school, and a collision on the
// primary key is retried below with fresh ids.
const SUFFIX_LENGTH = 4;

function generateLearnerId(schoolId: string): string {
  let suffix = "";

  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    suffix +=
      ALPHANUMERIC[randomInt(ALPHANUMERIC.length)];
  }

  return `${schoolId}${suffix}`;
}

function prepareLearners(
  learners: CreateLearnerInput[],
  existingEmailsBySchool: Map<string, Set<string>>
): PreparedLearner[] {
  return learners.map((learner) => {
    // school_id is CHAR(4), so anything read back from Postgres arrives
    // blank-padded ("SSV "). Concatenating that padding into the learner id
    // pushes it past learner_id's VARCHAR(8) and the insert fails, so the
    // padding is stripped before the id is built.
    const schoolId = learner.school_id.trim();
    const taken = existingEmailsBySchool.get(schoolId) ?? new Set<string>();
    existingEmailsBySchool.set(schoolId, taken);

    return {
      ...learner,
      learner_id: generateLearnerId(schoolId),
      email: generateUniqueEmail(learner.first_name, learner.last_name, schoolId, taken),
    };
  });
}

function cloneEmailSets(bySchool: Map<string, Set<string>>): Map<string, Set<string>> {
  return new Map([...bySchool].map(([schoolId, emails]) => [schoolId, new Set(emails)]));
}

async function loadExistingEmails(schoolIds: string[]): Promise<Map<string, Set<string>>> {
  const bySchool = new Map<string, Set<string>>();
  for (const schoolId of new Set(schoolIds)) {
    const existing = await query(
      `SELECT email FROM learners WHERE school_id = $1 AND email IS NOT NULL`,
      [schoolId]
    );
    bySchool.set(schoolId, new Set(existing.rows.map((row) => row.email as string)));
  }
  return bySchool;
}

export async function createLearners(
  learners: CreateLearnerInput[]
) {
  if (learners.length === 0) {
    return [];
  }

  const existingEmailsBySchool = await loadExistingEmails(
    learners.map((learner) => learner.school_id.trim())
  );

  for (
    let attempt = 1;
    attempt <= MAX_RETRIES;
    attempt++
  ) {
    // Cloned per attempt: prepareLearners mutates these sets as it hands out
    // addresses, and a retry (on a learner_id collision) must start back from
    // just the addresses that actually exist in the database.
    const preparedLearners =
      prepareLearners(learners, cloneEmailSets(existingEmailsBySchool));

    try {
      return await transaction(async (client) => {

        // -----------------------------
        // 1. INSERT LEARNERS
        // -----------------------------

        const learnerValues: unknown[] = [];

        const learnerPlaceholders =
          preparedLearners.map(
            (learner, index) => {
              const offset = index * 7;

              learnerValues.push(
                learner.learner_id,
                learner.school_id,
                learner.first_name,
                learner.last_name,
                learner.gender_id,
                learner.date_of_birth,
                learner.email
              );

              return `(
                $${offset + 1},
                $${offset + 2},
                $${offset + 3},
                $${offset + 4},
                $${offset + 5},
                $${offset + 6},
                $${offset + 7}
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
            date_of_birth,
            email
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