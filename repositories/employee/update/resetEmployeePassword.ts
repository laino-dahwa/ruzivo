import { query } from "../../../lib/db";
import { generateTemporaryPassword, hashPassword } from "../../../lib/auth/password";

export type ResetEmployeePassword = {
  employee_id: number;
  first_name: string;
  last_name: string;
  email: string;
  /**
   * The new one-time password in the clear. Only ever present on the response
   * to the reset that generated it — never stored, and never returned again.
   */
  temporary_password: string;
};

/**
 * An administrator's reset of someone else's password: issues a fresh
 * one-time password, the same way account creation does
 * (repositories/employee/create), and requires it to be changed at next
 * sign-in. Also clears any lockout, so a reset is the "unlock" too.
 *
 * Scoped to the school, so an id from another school matches nothing.
 * Returns null when no live employee matches. The caller is expected to
 * revoke the employee's sessions afterwards.
 */
export async function resetEmployeePassword(school_id: string, employee_id: number): Promise<ResetEmployeePassword | null> {
  const temporaryPassword = generateTemporaryPassword();
  const result = await query(
    `
    UPDATE employees
    SET password_hash = $3,
        must_change_password = TRUE,
        failed_login_count = 0,
        locked_until = NULL
    WHERE school_id = $1 AND employee_id = $2 AND deleted_at IS NULL
    RETURNING employee_id, first_name, last_name, email
    `,
    [school_id.trim(), employee_id, hashPassword(temporaryPassword)]
  );

  const row = result.rows[0];
  return row ? { ...row, employee_id: Number(row.employee_id), temporary_password: temporaryPassword } : null;
}
