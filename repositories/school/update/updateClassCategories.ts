import { query } from "../../../lib/db";

type UpdateClassCategory = {
  school_id: string; 
  class_name ?:string,
};

export async function UpdateClassCategory(class_categories: UpdateClassCategory[]) {
  if (class_categories.length === 0) {
    return [];
  }

  const values: unknown[] = [];

  const placeholders = class_categories.map((class_category, index) => {
    const offset = index * 2;

    values.push(
      class_category.school_id,
      class_category.class_name ?? null,
    );

    return `(
      $${offset + 1},
      $${offset + 2}
    )`;
  });

  const result = await query(
    `
    UPDATE class_categories AS s
    SET
      class_name = COALESCE(v.class_name, s.class_name),

    FROM (
      VALUES
        ${placeholders.join(",")}
    ) AS v(
      school_id,
      class_name,
    )

    WHERE s.school_id = v.school_id

    RETURNING
      s.school_id,
      s.class_name,
    `,
    values
  );

  return result.rows;
}