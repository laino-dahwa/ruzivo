import { query } from "../../../lib/db";

export type EmployeeRow = {
  employee_id: number;
  school_id: string;
  first_name: string;
  last_name: string;
  role_name: string;
  email: string;
  must_change_password: boolean;
  created_at: string;
};

/** Never selects password_hash — it has no reason to leave the database. */
export async function getEmployees(school_id: string): Promise<EmployeeRow[]> {
  const result = await query(
    `
    SELECT e.employee_id, e.school_id, e.first_name, e.last_name, r.role_name,
           e.email, e.must_change_password, e.created_at
    FROM employees e
    JOIN roles r ON r.role_id = e.role_id
    WHERE e.school_id = $1
    ORDER BY e.last_name, e.first_name
    `,
    [school_id]
  );
  return result.rows;
}
