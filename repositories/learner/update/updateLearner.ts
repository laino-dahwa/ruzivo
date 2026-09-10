import { transaction } from "../../../lib/db";

export type UpdateLearnerInput = {
  learner_id: string;
  enrolment_id: number;

  first_name?: string;
  last_name?: string;
  gender_id?: number;
  date_of_birth?: string;

  class_category_id?: number;
  academic_year_id?: number;
};

/**
 * Raised when the database refuses an otherwise well-formed edit, so the route
 * can answer with the reason rather than a generic 500.
 */
export class LearnerUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LearnerUpdateError";
  }
}

// One row of the VALUES list. Every column is cast explicitly: the parameters
// arrive untyped, and an uncast NULL leaves Postgres unable to match
// COALESCE(v.gender_id, l.gender_id) against a bigint column ("COALESCE types
// text and bigint cannot be matched"), which made every update fail.
const COLUMNS_PER_ROW = 8;

const CASTS = [
  "::varchar(8)",  // learner_id
  "::bigint",      // enrolment_id
  "::text",        // first_name
  "::text",        // last_name
  "::bigint",      // gender_id
  "::date",        // date_of_birth
  "::bigint",      // class_category_id
  "::bigint",      // academic_year_id
];

const VALUE_COLUMNS = `(
  learner_id,
  enrolment_id,
  first_name,
  last_name,
  gender_id,
  date_of_birth,
  class_category_id,
  academic_year_id
)`;

/**
 * Applies partial edits to learners and their enrolments in one transaction.
 * `learner_id` is never editable — it identifies the row being changed and is
 * the key every dependent table (enrolments, charges, payments) references.
 * Any field left undefined keeps its current value.
 */
export async function updateLearners(learners: UpdateLearnerInput[]) {
  if (learners.length === 0) {
    return { learners: [], enrolments: [] };
  }

  const values: unknown[] = [];

  const placeholders = learners.map((learner, index) => {
    const offset = index * COLUMNS_PER_ROW;

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

    const row = CASTS.map(
      (cast, column) => `$${offset + column + 1}${cast}`
    );

    return `(${row.join(", ")})`;
  });

  const valuesClause = `
    FROM (
      VALUES
        ${placeholders.join(",")}
    ) AS v ${VALUE_COLUMNS}
  `;

  try {
    return await transaction(async (client) => {

      // --------------------------------
      // 1. UPDATE LEARNERS
      // --------------------------------

      const learnerResult = await client.query(
        `
        UPDATE learners AS l
        SET
          first_name = COALESCE(v.first_name, l.first_name),
          last_name = COALESCE(v.last_name, l.last_name),
          gender_id = COALESCE(v.gender_id, l.gender_id),
          date_of_birth = COALESCE(v.date_of_birth, l.date_of_birth),
          updated_at = CURRENT_TIMESTAMP
        ${valuesClause}
        WHERE l.learner_id = v.learner_id
          AND l.deleted_at IS NULL
        RETURNING
          l.learner_id,
          l.school_id,
          l.first_name,
          l.last_name,
          l.gender_id::int AS gender_id,
          TO_CHAR(l.date_of_birth, 'YYYY-MM-DD') AS date_of_birth
        `,
        values
      );

      // A learner that matched nothing is either unknown or already deleted.
      // Reported before the enrolment update so the caller never sees a
      // half-applied edit.
      if (learnerResult.rowCount !== learners.length) {
        const updated = new Set(
          learnerResult.rows.map((row) => row.learner_id)
        );

        const missing = learners
          .map((learner) => learner.learner_id)
          .filter((id) => !updated.has(id));

        throw new LearnerUpdateError(
          `Learner not found or already deleted: ${missing.join(", ")}`
        );
      }

      // --------------------------------
      // 2. UPDATE ENROLMENTS
      // --------------------------------

      const enrolmentResult = await client.query(
        `
        UPDATE enrolments AS e
        SET
          class_category_id = COALESCE(v.class_category_id, e.class_category_id),
          academic_year_id = COALESCE(v.academic_year_id, e.academic_year_id)
        ${valuesClause}
        WHERE e.enrolment_id = v.enrolment_id
          AND e.learner_id = v.learner_id
        RETURNING
          e.enrolment_id::int AS enrolment_id,
          e.learner_id,
          e.class_category_id::int AS class_category_id,
          e.academic_year_id::int AS academic_year_id
        `,
        values
      );

      // The enrolment must belong to the learner being edited; a mismatch
      // means the caller sent a stale or foreign enrolment_id.
      if (enrolmentResult.rowCount !== learners.length) {
        throw new LearnerUpdateError(
          "Enrolment not found for this learner. Refresh the list and try again."
        );
      }

      return {
        learners: learnerResult.rows,
        enrolments: enrolmentResult.rows,
      };
    });

  } catch (error: unknown) {
    if (error instanceof Error && "code" in error) {
      const code = (error as { code?: string }).code;
      const constraint = (error as { constraint?: string }).constraint;

      // enrolments carries UNIQUE (learner_id, academic_year_id), so moving a
      // learner into a year they are already enrolled in is a real conflict
      // rather than a server fault.
      if (code === "23505" && constraint === "uq_learner_year") {
        throw new LearnerUpdateError(
          "This learner already has an enrolment for that academic year."
        );
      }

      // A gender, class or academic year that does not exist (or belongs to
      // another school's reference data that has since been removed).
      if (code === "23503") {
        throw new LearnerUpdateError(
          "The selected gender, class or academic year no longer exists."
        );
      }
    }

    throw error;
  }
}
