import type { PoolClient } from "pg";
import { transaction } from "../../lib/db";
import { localDateKey } from "../../lib/dates";
import { formatCurrency } from "../../lib/currency";
import { logAuditWithin } from "../audit/writeAuditLog";
import { keyString, lockLimitKeys } from "../payment/create/createNewPayment";
import { pendingFeesCte } from "./pendingFeesQuery";
import type { ExemptionKey, ExpectedFeeAction, ExpectedFeeActionResult, FeeKey } from "../../types/expected-fees";

export type DecisionActor = { employee_id: number; label: string };

/**
 * Applies one Accept / Deny / Undo action to a set of expected fees, in one
 * transaction, with one audit entry.
 *
 *  - ACCEPT: the fee becomes owed (a balance), at the fee's current amount,
 *    which is then fixed for that fee.
 *  - SKIP: denied for this period only.
 *  - EXEMPT: denied forever - the learner is never suggested the fee again.
 *  - UNDO_ACCEPT: an accepted fee goes back to pending, only while nothing
 *    has been paid toward it.
 *  - UNDO_SKIP: a skipped period goes back to pending.
 *  - RESTORE: an exemption is lifted; the fee is suggested again.
 *
 * ACCEPT and SKIP only touch fees that are still pending when the request
 * runs (checked against the suggestions engine itself, so the school, the
 * learner and the fee's applicability are all enforced). Anything accepted,
 * paid or denied since the page loaded is left alone and counted as
 * `unchanged` rather than failing the whole batch.
 */
export async function applyExpectedFeeAction(
  school_id: string,
  action: ExpectedFeeAction,
  actor: DecisionActor,
  today: string = localDateKey(),
): Promise<ExpectedFeeActionResult> {
  return transaction(async (client) => {
    switch (action.action) {
      case "ACCEPT":
      case "SKIP":
        return decidePending(client, school_id, action.action, uniqueFeeKeys(action.items), actor, today);
      case "UNDO_ACCEPT":
      case "UNDO_SKIP":
        return undoDecision(client, school_id, action.action, uniqueFeeKeys(action.items), actor);
      case "EXEMPT":
        return exempt(client, school_id, uniqueExemptionKeys(action.items), action.reason, actor);
      case "RESTORE":
        return restore(client, school_id, uniqueExemptionKeys(action.items), actor);
    }
  });
}

function uniqueFeeKeys(items: FeeKey[]): FeeKey[] {
  return [...new Map(items.map((item) => [keyString(item), item])).values()];
}

function uniqueExemptionKeys(items: ExemptionKey[]): ExemptionKey[] {
  return [...new Map(items.map((item) => [`${item.learner_id}|${item.income_category_id}`, item])).values()];
}

/** The four parallel arrays `unnest(...) AS k(learner_id, income_category_id, payment_period_id, academic_year_id)` takes. */
function keyArrays(keys: FeeKey[]) {
  return [
    keys.map((k) => k.learner_id),
    keys.map((k) => k.income_category_id),
    keys.map((k) => k.payment_period_id),
    keys.map((k) => k.academic_year_id),
  ];
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** "for Jane Doe" when every row is one learner's, otherwise "for 4 learners". */
function forWhom(rows: { learner_id: string; first_name?: string; last_name?: string }[]): string {
  const learners = new Map(rows.map((row) => [row.learner_id, `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim()]));
  if (learners.size === 1) {
    const [[id, name]] = [...learners.entries()];
    return `for ${name || id}`;
  }
  return `for ${plural(learners.size, "learner")}`;
}

function soleLearner(rows: { learner_id: string }[]): string | null {
  const ids = new Set(rows.map((row) => row.learner_id));
  return ids.size === 1 ? [...ids][0] : null;
}

async function decidePending(
  client: PoolClient,
  school_id: string,
  decision: "ACCEPT" | "SKIP",
  keys: FeeKey[],
  actor: DecisionActor,
  today: string,
): Promise<ExpectedFeeActionResult> {
  if (keys.length === 0) return { changed: 0, unchanged: 0, amount: 0 };

  // Taken before reading what is pending, so a payment for the same fee
  // cannot land between the check and the insert.
  await lockLimitKeys(client, keys.map(keyString));

  const pending = await client.query(
    `
    ${pendingFeesCte("$2")}
    SELECT p.learner_id, p.first_name, p.last_name, p.income_category_id, p.income_name,
           p.payment_period_id, p.period_name, p.academic_year_id, p.academic_year_name, p.amount
    FROM pending p
    JOIN unnest($3::varchar[], $4::bigint[], $5::bigint[], $6::bigint[])
      AS k(learner_id, income_category_id, payment_period_id, academic_year_id)
      ON k.learner_id = p.learner_id
     AND k.income_category_id = p.income_category_id
     AND k.payment_period_id = p.payment_period_id
     AND k.academic_year_id = p.academic_year_id
    `,
    [school_id, today, ...keyArrays(keys)]
  );
  const rows = pending.rows;
  const unchanged = keys.length - rows.length;
  if (rows.length === 0) return { changed: 0, unchanged, amount: 0 };

  const accepting = decision === "ACCEPT";
  await client.query(
    `
    INSERT INTO fee_decisions (
      school_id, learner_id, income_category_id, payment_period_id, academic_year_id,
      decision, amount, source, decided_by_employee_id, decided_by_label
    )
    SELECT $1, k.learner_id, k.income_category_id, k.payment_period_id, k.academic_year_id,
           $7, k.amount, 'DECISION', $8, $9
    FROM unnest($2::varchar[], $3::bigint[], $4::bigint[], $5::bigint[], $6::numeric[])
      AS k(learner_id, income_category_id, payment_period_id, academic_year_id, amount)
    `,
    [
      school_id,
      ...keyArrays(rows.map((row) => ({
        learner_id: row.learner_id,
        income_category_id: Number(row.income_category_id),
        payment_period_id: Number(row.payment_period_id),
        academic_year_id: Number(row.academic_year_id),
      }))),
      rows.map((row) => (accepting ? row.amount : null)),
      accepting ? "ACCEPTED" : "SKIPPED",
      actor.employee_id,
      actor.label,
    ]
  );

  const amount = accepting ? rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0) : 0;
  await logAuditWithin(client, {
    employee_id: actor.employee_id,
    actor_label: actor.label,
    school_id,
    action: accepting ? "expected_fee.accept" : "expected_fee.skip",
    entity_type: "expected_fee",
    entity_id: soleLearner(rows),
    summary: accepting
      ? `Accepted ${plural(rows.length, "expected fee")} ${forWhom(rows)}, ${formatCurrency(amount)} now owed`
      : `Denied ${plural(rows.length, "expected fee")} ${forWhom(rows)} for this period`,
    detail: rows.map((row) => ({
      learner_id: row.learner_id,
      income_name: row.income_name,
      period_name: row.period_name,
      academic_year_name: row.academic_year_name,
      amount: accepting ? row.amount : undefined,
    })),
  });

  return { changed: rows.length, unchanged, amount };
}

async function undoDecision(
  client: PoolClient,
  school_id: string,
  action: "UNDO_ACCEPT" | "UNDO_SKIP",
  keys: FeeKey[],
  actor: DecisionActor,
): Promise<ExpectedFeeActionResult> {
  if (keys.length === 0) return { changed: 0, unchanged: 0, amount: 0 };
  await lockLimitKeys(client, keys.map(keyString));

  const accepted = action === "UNDO_ACCEPT";
  const removed = await client.query(
    `
    DELETE FROM fee_decisions fd
    USING unnest($2::varchar[], $3::bigint[], $4::bigint[], $5::bigint[])
      AS k(learner_id, income_category_id, payment_period_id, academic_year_id)
    WHERE fd.school_id = $1
      AND fd.learner_id = k.learner_id
      AND fd.income_category_id = k.income_category_id
      AND fd.payment_period_id = k.payment_period_id
      AND fd.academic_year_id = k.academic_year_id
      AND fd.decision = $6
      -- Once anything is paid toward a fee, its acceptance stands: the
      -- payment has to be deleted first.
      AND NOT EXISTS (
        SELECT 1 FROM charges c
        WHERE c.learner_id = fd.learner_id
          AND c.income_category_id = fd.income_category_id
          AND c.payment_period_id = fd.payment_period_id
          AND c.academic_year_id = fd.academic_year_id
      )
    RETURNING fd.learner_id, fd.income_category_id, fd.payment_period_id, fd.academic_year_id, fd.amount
    `,
    [school_id, ...keyArrays(keys), accepted ? "ACCEPTED" : "SKIPPED"]
  );

  const rows = removed.rows;
  if (rows.length > 0) {
    const amount = rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
    await logAuditWithin(client, {
      employee_id: actor.employee_id,
      actor_label: actor.label,
      school_id,
      action: accepted ? "expected_fee.undo_accept" : "expected_fee.undo_skip",
      entity_type: "expected_fee",
      entity_id: soleLearner(rows),
      summary: accepted
        ? `Withdrew ${plural(rows.length, "accepted fee")} (${formatCurrency(amount)}) back to expected fees`
        : `Brought back ${plural(rows.length, "denied period")} to expected fees`,
      detail: rows,
    });
  }

  return { changed: rows.length, unchanged: keys.length - rows.length, amount: 0 };
}

async function exempt(
  client: PoolClient,
  school_id: string,
  keys: ExemptionKey[],
  reason: string,
  actor: DecisionActor,
): Promise<ExpectedFeeActionResult> {
  if (keys.length === 0) return { changed: 0, unchanged: 0, amount: 0 };

  // Only this school's active learners and this school's fees: the join
  // drops anything else, and ON CONFLICT drops exemptions that already exist.
  const inserted = await client.query(
    `
    WITH inserted AS (
      INSERT INTO fee_exemptions (school_id, learner_id, income_category_id, reason, exempted_by_employee_id, exempted_by_label)
      SELECT $1, l.learner_id, ic.income_category_id, $4, $5, $6
      FROM unnest($2::varchar[], $3::bigint[]) AS k(learner_id, income_category_id)
      JOIN learners l ON l.learner_id = k.learner_id AND l.school_id = $1 AND l.deleted_at IS NULL
      JOIN income_categories ic ON ic.income_category_id = k.income_category_id AND ic.school_id = $1
      ON CONFLICT (learner_id, income_category_id) DO NOTHING
      RETURNING learner_id, income_category_id
    )
    SELECT i.learner_id, i.income_category_id, l.first_name, l.last_name, ic.income_name
    FROM inserted i
    JOIN learners l ON l.learner_id = i.learner_id
    JOIN income_categories ic ON ic.income_category_id = i.income_category_id
    `,
    [school_id, keys.map((k) => k.learner_id), keys.map((k) => k.income_category_id), reason, actor.employee_id, actor.label]
  );

  const rows = inserted.rows;
  if (rows.length > 0) {
    const fees = [...new Set(rows.map((row) => row.income_name))].join(", ");
    await logAuditWithin(client, {
      employee_id: actor.employee_id,
      actor_label: actor.label,
      school_id,
      action: "expected_fee.exempt",
      entity_type: "expected_fee",
      entity_id: soleLearner(rows),
      summary: `Denied ${fees} forever ${forWhom(rows)}: ${reason}`,
      detail: { reason, items: rows },
    });
  }

  return { changed: rows.length, unchanged: keys.length - rows.length, amount: 0 };
}

async function restore(
  client: PoolClient,
  school_id: string,
  keys: ExemptionKey[],
  actor: DecisionActor,
): Promise<ExpectedFeeActionResult> {
  if (keys.length === 0) return { changed: 0, unchanged: 0, amount: 0 };

  const removed = await client.query(
    `
    DELETE FROM fee_exemptions fx
    USING unnest($2::varchar[], $3::bigint[]) AS k(learner_id, income_category_id)
    WHERE fx.school_id = $1
      AND fx.learner_id = k.learner_id
      AND fx.income_category_id = k.income_category_id
    RETURNING fx.learner_id, fx.income_category_id, fx.reason
    `,
    [school_id, keys.map((k) => k.learner_id), keys.map((k) => k.income_category_id)]
  );

  const rows = removed.rows;
  if (rows.length > 0) {
    await logAuditWithin(client, {
      employee_id: actor.employee_id,
      actor_label: actor.label,
      school_id,
      action: "expected_fee.restore",
      entity_type: "expected_fee",
      entity_id: soleLearner(rows),
      summary: `Lifted ${plural(rows.length, "fee exemption")}; those fees are suggested again`,
      detail: rows,
    });
  }

  return { changed: rows.length, unchanged: keys.length - rows.length, amount: 0 };
}
