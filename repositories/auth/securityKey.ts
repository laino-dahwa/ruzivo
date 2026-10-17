import type { PoolClient } from "pg";
import { query } from "../../lib/db";
import { hashPassword } from "../../lib/auth/password";
import { generateSecurityKey, normaliseSecurityKey } from "../../lib/auth/securityKey";

/**
 * Issues a new security key for an employee, replacing any previous one, and
 * returns it in the clear — the only time it ever exists in readable form.
 * Pass `client` to issue it inside the caller's transaction (first-run setup).
 */
export async function issueSecurityKey(employee_id: number, client?: PoolClient): Promise<string> {
  const key = generateSecurityKey();
  const sql = `UPDATE employees SET security_key_hash = $2, security_key_created_at = now() WHERE employee_id = $1`;
  const values = [employee_id, hashPassword(normaliseSecurityKey(key))];
  if (client) {
    await client.query(sql, values);
  } else {
    await query(sql, values);
  }
  return key;
}

/** Whether the employee has a key, and since when — never the key or its hash. */
export async function getSecurityKeyStatus(employee_id: number): Promise<{ has_key: boolean; created_at: string | null }> {
  const result = await query(
    `SELECT security_key_hash IS NOT NULL AS has_key, security_key_created_at AS created_at FROM employees WHERE employee_id = $1`,
    [employee_id]
  );
  const row = result.rows[0];
  return { has_key: !!row?.has_key, created_at: row?.created_at ?? null };
}
