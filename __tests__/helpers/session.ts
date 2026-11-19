import { query } from "../../lib/db";
import { createSession } from "../../lib/auth/session";
import { createEmployees } from "../../repositories/employee/create/createEmployee";
import type { AccessLevel } from "../../lib/auth/permissions";

/**
 * Every API route checks the caller is signed in (lib/auth/guard.ts), so the
 * suites that call route handlers need a real session. This makes one: an
 * employee in the suite's own test school, with a role at `level`, and a
 * session on that school.
 *
 * It is cleaned up with the school: employees, roles and sessions all cascade
 * from `schools`, which every suite already deletes in its afterAll.
 */
let cookie: string | null = null;

export async function signInForTests(school_id: string, level: AccessLevel = "ADMIN"): Promise<string> {
  const role = await query(
    `INSERT INTO roles (school_id, role_name, access_level) VALUES ($1, $2, $3) RETURNING role_id`,
    [school_id, `Test ${level.toLowerCase()} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, level]
  );
  const [employee] = await createEmployees([{
    school_id,
    first_name: "Test",
    last_name: level === "ADMIN" ? "Admin" : "Cashier",
    role_id: Number(role.rows[0].role_id),
  }]);
  // A fresh account must change its password before anything else; a test
  // session is past that step.
  await query(`UPDATE employees SET must_change_password = FALSE WHERE employee_id = $1`, [employee.employee_id]);
  const { token } = await createSession(Number(employee.employee_id), school_id);
  cookie = `ssv_session=${token}`;
  return cookie;
}

/** `init` with the session cookie from the last signInForTests() added. */
export function withSession(init?: RequestInit, sessionCookie: string | null = cookie): RequestInit {
  const headers = new Headers(init?.headers);
  if (sessionCookie) headers.set("cookie", sessionCookie);
  return { ...init, headers };
}

/** A Request carrying the session cookie. */
export function signedRequest(url: string, init?: RequestInit): Request {
  return new Request(url, withSession(init));
}
