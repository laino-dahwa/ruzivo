import { transaction } from "../../../lib/db";
import { generateUniqueEmail } from "../../../lib/identity/email";
import { generateTemporaryPassword, hashPassword } from "../../../lib/auth/password";

export type CreateEmployeeInput = {
  school_id: string;
  first_name: string;
  last_name: string;
  /** Must reference an existing row in roles for this school. */
  role_id: number;
};

export type CreatedEmployee = {
  employee_id: number;
  school_id: string;
  first_name: string;
  last_name: string;
  role_name: string;
  email: string;
  must_change_password: boolean;
  created_at: string;
  /**
   * The one-time password in the clear. Only ever present on the response to
   * the create call that generated it — never stored, and never returned by
   * any later read.
   */
  temporary_password: string;
};

/**
 * Creates one or more staff accounts. `email` and `password_hash` are never
 * accepted from the caller — both are generated here, matching how
 * `learner_id` is generated rather than supplied (repositories/learner/create).
 */
export async function createEmployees(employees: CreateEmployeeInput[]): Promise<CreatedEmployee[]> {
  if (employees.length === 0) return [];

  return transaction(async (client) => {
    // Scoped per school_id in the (likely) common case of a single school per
    // batch, but a plain Set works fine across schools too — the email is
    // globally unique text, not compared per-school here.
    const taken = new Set<string>();
    for (const schoolId of new Set(employees.map((e) => e.school_id))) {
      const existing = await client.query<{ email: string }>(
        `SELECT email FROM employees WHERE school_id = $1`,
        [schoolId.trim()]
      );
      existing.rows.forEach((row) => taken.add(row.email));
    }

    const prepared = employees.map((employee) => {
      const schoolId = employee.school_id.trim();
      const email = generateUniqueEmail(employee.first_name, employee.last_name, schoolId, taken);
      const temporaryPassword = generateTemporaryPassword();
      return {
        school_id: schoolId,
        first_name: employee.first_name,
        last_name: employee.last_name,
        role_id: employee.role_id,
        email,
        temporary_password: temporaryPassword,
        password_hash: hashPassword(temporaryPassword),
      };
    });

    const values: unknown[] = [];
    const placeholders = prepared.map((employee, index) => {
      const offset = index * 6;
      values.push(
        employee.school_id,
        employee.first_name,
        employee.last_name,
        employee.role_id,
        employee.email,
        employee.password_hash
      );
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`;
    });

    // A CTE rather than a plain RETURNING because role_name lives on roles,
    // not employees — RETURNING can only expose the inserted table's own
    // columns/expressions. Ordered explicitly by employee_id (assigned
    // sequentially as the VALUES list is inserted): the SELECT over a CTE
    // makes no row-order guarantee on its own, and getting this wrong would
    // zip a temporary password below to the wrong employee.
    const result = await client.query(
      `
      WITH inserted AS (
        INSERT INTO employees (school_id, first_name, last_name, role_id, email, password_hash)
        VALUES ${placeholders.join(", ")}
        RETURNING employee_id, school_id, first_name, last_name, role_id, email, must_change_password, created_at
      )
      SELECT i.employee_id, i.school_id, i.first_name, i.last_name, r.role_name, i.email, i.must_change_password, i.created_at
      FROM inserted i
      JOIN roles r ON r.role_id = i.role_id
      ORDER BY i.employee_id
      `,
      values
    );

    // Rows come back ordered by employee_id, which increments sequentially in
    // VALUES order, so this zips back up with the plaintext passwords by
    // position.
    return result.rows.map((row, index) => ({
      ...row,
      temporary_password: prepared[index].temporary_password,
    }));
  });
}
