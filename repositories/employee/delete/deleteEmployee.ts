import { query } from "../../../lib/db";

export async function deleteEmployee(school_id: string, employee_id: number) {
  const result = await query(
    `
    DELETE FROM employees
    WHERE employee_id = $1
      AND school_id = $2
    RETURNING employee_id, school_id, first_name, last_name, role_id, email, must_change_password, created_at
    `,
    [employee_id, school_id]
  );

  if (result.rowCount === 0) {
    throw new Error("No employee with that id belongs to this school.");
  }

  return result.rows[0];
}
