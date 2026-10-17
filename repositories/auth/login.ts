import { query } from "../../lib/db";

export type LoginCandidate = {
  employee_id: number;
  school_id: string;
  first_name: string;
  last_name: string;
  email: string;
  password_hash: string;
  must_change_password: boolean;
  access_level: string;
  locked_until: Date | null;
  failed_login_count: number;
  /** Null when the account has no security key (repositories/auth/securityKey.ts). */
  security_key_hash: string | null;
};

/**
 * Looks an account up by email alone.
 *
 * `employees` is unique on (school_id, email) rather than on email, but the
 * generated address embeds the school id in its domain
 * ("jdoe@abcd.school" — see lib/identity/email.ts) and school ids are unique,
 * so an address is in practice globally unique and the sign-in form needs no
 * school picker. The LIMIT 2 below is what makes that "in practice" safe: if
 * an address ever did match twice, the caller refuses rather than guessing.
 */
export async function findEmployeeForLogin(email: string): Promise<LoginCandidate[]> {
  const result = await query(
    `
    SELECT
      e.employee_id::int AS employee_id,
      e.school_id,
      e.first_name,
      e.last_name,
      e.email,
      e.password_hash,
      e.must_change_password,
      e.failed_login_count,
      e.locked_until,
      e.security_key_hash,
      r.access_level
    FROM employees e
    JOIN roles r ON r.role_id = e.role_id
    WHERE lower(e.email) = lower($1)
      AND e.deleted_at IS NULL
    LIMIT 2
    `,
    [email]
  );

  return result.rows.map((row) => ({ ...row, school_id: row.school_id.trim() }));
}

/**
 * Locks an account for a spell after repeated failures.
 *
 * Proportionate to the threat on an offline, single-machine install: this
 * exists to make guessing a colleague's password tedious, not to withstand a
 * botnet. The lock expires on its own so nobody has to be unlocked by hand
 * after a bad morning — though an administrator can clear it early.
 */
const LOCK_AFTER_FAILURES = 5;
const LOCK_MINUTES = 15;

export async function recordFailedLogin(employee_id: number): Promise<void> {
  await query(
    `
    UPDATE employees
    SET failed_login_count = failed_login_count + 1,
        locked_until = CASE
          WHEN failed_login_count + 1 >= $2 THEN now() + make_interval(mins => $3)
          ELSE locked_until
        END
    WHERE employee_id = $1
    `,
    [employee_id, LOCK_AFTER_FAILURES, LOCK_MINUTES]
  );
}

export async function recordSuccessfulLogin(employee_id: number): Promise<void> {
  await query(
    `
    UPDATE employees
    SET failed_login_count = 0,
        locked_until = NULL,
        last_login_at = now()
    WHERE employee_id = $1
    `,
    [employee_id]
  );
}

export function isLocked(candidate: Pick<LoginCandidate, "locked_until">): boolean {
  return candidate.locked_until !== null && candidate.locked_until.getTime() > Date.now();
}
