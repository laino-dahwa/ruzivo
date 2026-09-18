import type { PoolClient } from "pg";
import { query } from "../../lib/db";

export type AuditEntry = {
  /** Null only when the actor's employee row has since been deleted. */
  employee_id: number | null;
  /** Snapshot of the actor's name, so the entry stays readable forever. */
  actor_label: string;
  school_id: string | null;
  /** Dotted verb, matching the capability names: "payment.create", "auth.login". */
  action: string;
  entity_type: string;
  entity_id?: string | null;
  /** One human-readable line, as it will be shown in the audit view. */
  summary: string;
  /** Anything worth keeping that has no column — notably a snapshot of a row about to be deleted. */
  detail?: unknown;
};

const INSERT = `
  INSERT INTO audit_log (employee_id, actor_label, school_id, action, entity_type, entity_id, summary, detail)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
`;

function params(entry: AuditEntry) {
  return [
    entry.employee_id,
    entry.actor_label,
    entry.school_id,
    entry.action,
    entry.entity_type,
    entry.entity_id ?? null,
    entry.summary,
    entry.detail === undefined ? null : JSON.stringify(entry.detail),
  ];
}

/**
 * Writes an audit entry inside the caller's transaction.
 *
 * Use this whenever the thing being logged is itself transactional. Logging
 * on a separate connection would leave an entry claiming a payment was taken
 * even when that payment's transaction later rolled back — which is worse
 * than no audit trail at all, because it is confidently wrong.
 */
export async function logAuditWithin(client: PoolClient, entry: AuditEntry): Promise<void> {
  await client.query(INSERT, params(entry));
}

/** For actions that are not part of a wider transaction — sign-in, sign-out. */
export async function logAudit(entry: AuditEntry): Promise<void> {
  await query(INSERT, params(entry));
}
