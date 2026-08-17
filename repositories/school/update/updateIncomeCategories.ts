import { query } from "../../../lib/db";

type UpdateIncomeCategory= {
  school_id :string,
  income_name :string,
  income_limit :string
};

export async function UpdateIncomeCategory(income_categories: UpdateIncomeCategory[]) {
  if (income_categories.length === 0) {
    return [];
  }

  const values: unknown[] = [];

  const placeholders = income_categories.map((income_category, index) => {
    const offset = index * 3;

    values.push(
      income_category.school_id,
      income_category.income_name ?? null,
      income_category.income_limit ?? null,
    );

    return `(
      $${offset + 1},
      $${offset + 2},
      $${offset + 3}
    
    )`;
  });

  const result = await query(
    `
    UPDATE income_categories AS s
    SET
      income_name = COALESCE(v.income_name, s.income_name),
      income_limit = COALESCE(v.income_limit, s.income_limit),
 

    FROM (
      VALUES
        ${placeholders.join(",")}
    ) AS v(
      school_id,
      income_name,
      income_limit,
      
    )

    WHERE s.school_id = v.school_id

    RETURNING
      s.school_id,
      s.income_name,
      s.income_limit,
   
    `,
    values
  );

  return result.rows;
}