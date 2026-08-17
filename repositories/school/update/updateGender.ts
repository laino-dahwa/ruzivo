import { query } from "../../../lib/db";

type UpdateGender = {
  school_id :string
  gender_name :string,
};

export async function updateGender(genders: UpdateGender[]) {
  if (genders.length === 0) {
    return [];
  }

  const values: unknown[] = [];

  const placeholders = genders.map((gender, index) => {
    const offset = index * 2;

    values.push(
      gender.school_id,
      gender.gender_name ?? null
      

    );

    return `(
      $${offset + 1},
      $${offset + 2}
    )`;
  });

  const result = await query(
    `
    UPDATE genders AS s
    SET
      gender_name = COALESCE(v.gender_name, s.gender_name),
  

    FROM (
      VALUES
        ${placeholders.join(",")}
    ) AS v(
      school_id,
      gender_name
    )

    WHERE s.school_id = v.school_id

    RETURNING
      s.school_id,
      s.gender_name,
    `,
    values
  );

  return result.rows;
}