import { query } from "../../lib/db";
import { hashPassword } from "../../lib/auth/password";

/** The stored hash for one employee, so a change can verify the current password first. */
export async function getPasswordHash(employee_id: number): Promise<string | null> {
  const result = await query(`SELECT password_hash FROM employees WHERE employee_id = $1 AND deleted_at IS NULL`, [employee_id]);
  return result.rows[0]?.password_hash ?? null;
}

/**
 * Sets a new password and clears the must-change flag.
 *
 * Callers are expected to revoke the employee's sessions immediately
 * afterwards: a password change should invalidate anything signed in with
 * the old one, including on another device.
 */
export async function setPassword(employee_id: number, plain: string): Promise<void> {
  await query(
    `
    UPDATE employees
    SET password_hash = $2,
        must_change_password = FALSE,
        failed_login_count = 0,
        locked_until = NULL
    WHERE employee_id = $1
    `,
    [employee_id, hashPassword(plain)]
  );
}
