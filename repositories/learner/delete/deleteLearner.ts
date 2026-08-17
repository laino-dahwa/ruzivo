import { query } from "../../../lib/db";

export async function deleteLearner(learnerId: string) {
  const result = await query(
    `
    UPDATE learners
    SET deleted_at = CURRENT_TIMESTAMP
    WHERE learner_id = $1
      AND deleted_at IS NULL
    RETURNING
      learner_id,
      school_id,
      first_name,
      last_name,
      deleted_at
    `,
    [learnerId]
  );

  if (result.rowCount === 0) {
    throw new Error(
      "Learner not found or already deleted."
    );
  }

  return result.rows[0];
}