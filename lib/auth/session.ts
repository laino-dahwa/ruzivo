import { query } from "../db";
import { generateSessionToken, hashSessionToken } from "./token";
import { isAccessLevel, type AccessLevel } from "./permissions";

/**
 * Idle timeout slides forward on every authenticated request; the absolute
 * cap never moves. Tuned for a shared office machine: long enough that a
 * cashier signs in once at the start of the day, short enough that a session
 * left open overnight is dead by morning.
 */
const IDLE_SECONDS = 4 * 60 * 60;
const ABSOLUTE_SECONDS = 12 * 60 * 60;

export type Actor = {
  employee_id: number;
  /** The employee's own school — fixed at creation, never changes. */
  school_id: string;
  /** The school this session is acting on. Only an administrator may change it. */
  active_school_id: string;
  access_level: AccessLevel;
  first_name: string;
  last_name: string;
  email: string;
  must_change_password: boolean;
};

/** "Jane Doe" — snapshotted into audit rows so they survive the employee. */
export function actorLabel(actor: Pick<Actor, "first_name" | "last_name">): string {
  return `${actor.first_name} ${actor.last_name}`.trim();
}

export async function createSession(employee_id: number, active_school_id: string): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();

  const result = await query(
    `
    INSERT INTO sessions (employee_id, token_hash, active_school_id, expires_at, absolute_expires_at)
    VALUES ($1, $2, $3, now() + make_interval(secs => $4), now() + make_interval(secs => $5))
    RETURNING expires_at
    `,
    [employee_id, hashSessionToken(token), active_school_id, IDLE_SECONDS, ABSOLUTE_SECONDS]
  );

  return { token, expiresAt: new Date(result.rows[0].expires_at) };
}

/**
 * Validates a token and slides its idle expiry, in one round trip.
 *
 * The access level is resolved by joining through to `roles` on every
 * request rather than being snapshotted into the session row, so demoting or
 * deactivating someone takes effect on their very next request without
 * needing a separate revocation step.
 */
export async function findSessionByToken(token: string): Promise<Actor | null> {
  const result = await query(
    `
    UPDATE sessions s
    SET last_seen_at = now(),
        -- Never slide past the absolute cap.
        expires_at = LEAST(now() + make_interval(secs => $2), s.absolute_expires_at)
    FROM employees e
    JOIN roles r ON r.role_id = e.role_id
    WHERE s.token_hash = $1
      AND e.employee_id = s.employee_id
      AND s.expires_at > now()
      AND s.absolute_expires_at > now()
      AND e.deleted_at IS NULL
    RETURNING
      e.employee_id::int   AS employee_id,
      e.school_id,
      s.active_school_id,
      r.access_level,
      e.first_name,
      e.last_name,
      e.email,
      e.must_change_password
    `,
    [hashSessionToken(token), IDLE_SECONDS]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  // A role whose access_level is not one the app knows is treated as no
  // session at all, rather than being silently coerced to a level.
  if (!isAccessLevel(row.access_level)) {
    return null;
  }

  return {
    employee_id: row.employee_id,
    school_id: row.school_id.trim(),
    active_school_id: row.active_school_id.trim(),
    access_level: row.access_level,
    first_name: row.first_name,
    last_name: row.last_name,
    email: row.email,
    must_change_password: row.must_change_password,
  };
}

export async function revokeSession(token: string): Promise<void> {
  await query(`DELETE FROM sessions WHERE token_hash = $1`, [hashSessionToken(token)]);
}

/** Used on password change, admin reset, and deactivation. */
export async function revokeAllSessionsFor(employee_id: number): Promise<void> {
  await query(`DELETE FROM sessions WHERE employee_id = $1`, [employee_id]);
}

/** Only an administrator may call this — the route checks, not this function. */
export async function setActiveSchool(token: string, school_id: string): Promise<void> {
  await query(`UPDATE sessions SET active_school_id = $2 WHERE token_hash = $1`, [hashSessionToken(token), school_id]);
}

/**
 * Housekeeping for expired rows. Cheap enough to call opportunistically on
 * login rather than needing a scheduled job — this app has no scheduler, and
 * an offline desktop install may go weeks between launches.
 */
export async function deleteExpiredSessions(): Promise<void> {
  await query(`DELETE FROM sessions WHERE absolute_expires_at < now() OR expires_at < now()`);
}
