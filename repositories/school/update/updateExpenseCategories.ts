import { query } from "../../../lib/db";

type UpdateExpenseCategories = {
  school_id :string
  expense_name :string,
};

export async function UpdateExpenseCategory(expenses: UpdateExpenseCategories[]) {
  if (expenses.length === 0) {
    return [];
  }

  const values: unknown[] = [];

  const placeholders = expenses.map((expense, index) => {
    const offset = index * 2;

    values.push(
      expense.school_id,
      expense.expense_name ?? null,
    
    );

    return `(
      $${offset + 1},
      $${offset + 2}
     
    )`;
  });

  const result = await query(
    `
    UPDATE expense_categories AS s
    SET
      expense_name = COALESCE(v.expense_name, s.expense_name),
     

    FROM (
      VALUES
        ${placeholders.join(",")}
    ) AS v(
      school_id,
      expense_name,
   
    )

    WHERE s.school_id = v.school_id

    RETURNING
      s.school_id,
      s.expense_name,
      
    `,
    values
  );

  return result.rows;
}