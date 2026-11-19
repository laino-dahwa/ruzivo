import { query } from "../../lib/db";
import { localDateKey } from "../../lib/dates";
import type { ExpectedFeeDecision, ExpectedFeeFilters, ExpectedFeeRow } from "../../types/expected-fees";
import { pendingFeesCte } from "./pendingFeesQuery";

/**
 * The Expected fees page's rows for one decision state, filtered by id.
 *
 * PENDING comes from the suggestions engine (pendingFeesQuery.ts); the other
 * three are the decisions people have made, so they can be reviewed and
 * undone. Every state returns the same row shape (ExpectedFeeRow).
 *
 * `today` decides which month-named periods have started; it defaults to the
 * machine's own date, which on the desktop app is the school's.
 */
export async function getExpectedFees(
  school_id: string,
  filters: ExpectedFeeFilters,
  today: string = localDateKey(),
): Promise<ExpectedFeeRow[]> {
  const decision: ExpectedFeeDecision = filters.decision ?? "PENDING";
  const params = [
    school_id,
    filters.class_category_id ?? null,
    filters.learner_id ?? null,
    filters.income_category_id ?? null,
    filters.priority ?? null,
    filters.academic_year_id ?? null,
    filters.payment_period_id ?? null,
  ];

  const result =
    decision === "PENDING" ? await query(pendingSql(), [...params, today])
    : decision === "EXEMPT" ? await query(exemptSql(), params)
    : await query(decidedSql(), [...params, decision === "ACCEPTED" ? "ACCEPTED" : "SKIPPED"]);

  return result.rows.map(toRow);
}

// $2..$7 are the filters, in the order built above. An exemption has no
// period or year, so those two filters do not narrow it.
const COMMON_FILTERS = `
  ($2::bigint IS NULL OR class_category_id = $2::bigint)
  AND ($3::text IS NULL OR learner_id = $3::text)
  AND ($4::bigint IS NULL OR income_category_id = $4::bigint)
  AND ($5::text IS NULL OR priority = $5::text)
`;
const PERIOD_FILTERS = `
  AND ($6::bigint IS NULL OR academic_year_id = $6::bigint)
  AND ($7::bigint IS NULL OR payment_period_id = $7::bigint)
`;
const ORDER = `ORDER BY last_name, first_name, learner_id, academic_year_name, priority, income_name, payment_period_id`;

/** `$1` school, `$2`..`$7` the filters, `$8` today. */
function pendingSql(): string {
  return `
    ${pendingFeesCte("$8")}
    SELECT
      learner_id, first_name, last_name, class_category_id, class_name,
      income_category_id, income_name, priority,
      payment_period_id, period_name, academic_year_id, academic_year_name,
      'PENDING' AS decision, amount, 0 AS paid, NULL AS source, NULL AS reason,
      NULL AS decided_by, NULL AS decided_at, FALSE AS can_undo
    FROM pending
    WHERE ${COMMON_FILTERS} ${PERIOD_FILTERS}
    ${ORDER}
  `;
}

function decidedSql(): string {
  return `
    WITH decided AS (
      SELECT
        l.learner_id, l.first_name, l.last_name,
        ca.class_category_id, ca.class_name,
        ic.income_category_id, ic.income_name, ic.priority,
        pp.payment_period_id, pp.period_name,
        ay.academic_year_id, ay.academic_year_name,
        fd.decision,
        CASE WHEN fd.decision = 'ACCEPTED' THEN COALESCE(fd.amount, ic.income_limit) ELSE ic.income_limit END AS amount,
        COALESCE(paid.total, 0) AS paid,
        CASE WHEN fd.decision = 'ACCEPTED' THEN fd.source END AS source,
        NULL AS reason,
        fd.decided_by_label AS decided_by,
        fd.decided_at,
        -- An accepted fee can be withdrawn only while nothing is paid toward it.
        (fd.decision = 'SKIPPED' OR paid.charges = 0) AS can_undo
      FROM fee_decisions fd
      JOIN learners l ON l.learner_id = fd.learner_id
      JOIN income_categories ic ON ic.income_category_id = fd.income_category_id
      JOIN payment_periods pp ON pp.payment_period_id = fd.payment_period_id
      JOIN academic_years ay ON ay.academic_year_id = fd.academic_year_id
      LEFT JOIN enrolments e ON e.learner_id = fd.learner_id AND e.academic_year_id = fd.academic_year_id
      LEFT JOIN class_categories ca ON ca.class_category_id = e.class_category_id
      CROSS JOIN LATERAL (
        SELECT COUNT(DISTINCT c.charge_id) AS charges, SUM(p.amount) AS total
        FROM charges c
        LEFT JOIN payment_allocations pa ON pa.charge_id = c.charge_id
        LEFT JOIN payments p ON p.payment_id = pa.payment_id
        WHERE c.learner_id = fd.learner_id
          AND c.income_category_id = fd.income_category_id
          AND c.payment_period_id = fd.payment_period_id
          AND c.academic_year_id = fd.academic_year_id
      ) paid
      WHERE fd.school_id = $1
        AND fd.decision = $8
        AND l.deleted_at IS NULL
    )
    SELECT * FROM decided
    WHERE ${COMMON_FILTERS} ${PERIOD_FILTERS}
    ${ORDER}
  `;
}

function exemptSql(): string {
  return `
    WITH exempt AS (
      SELECT
        l.learner_id, l.first_name, l.last_name,
        latest.class_category_id, latest.class_name,
        ic.income_category_id, ic.income_name, ic.priority,
        NULL::bigint AS payment_period_id, NULL AS period_name,
        NULL::bigint AS academic_year_id, NULL AS academic_year_name,
        'EXEMPT' AS decision, ic.income_limit AS amount, 0 AS paid, NULL AS source,
        fx.reason, fx.exempted_by_label AS decided_by, fx.exempted_at AS decided_at,
        TRUE AS can_undo
      FROM fee_exemptions fx
      JOIN learners l ON l.learner_id = fx.learner_id
      JOIN income_categories ic ON ic.income_category_id = fx.income_category_id
      LEFT JOIN LATERAL (
        SELECT ca.class_category_id, ca.class_name
        FROM enrolments e
        JOIN academic_years ay ON ay.academic_year_id = e.academic_year_id
        JOIN class_categories ca ON ca.class_category_id = e.class_category_id
        WHERE e.learner_id = fx.learner_id
        ORDER BY ay.start_date DESC
        LIMIT 1
      ) latest ON TRUE
      WHERE fx.school_id = $1
        AND l.deleted_at IS NULL
        -- An exemption covers every year and period, so these two filters
        -- never narrow it. They are still referenced so Postgres can type
        -- them: every state takes the same parameter list.
        AND ($6::bigint IS NULL OR TRUE)
        AND ($7::bigint IS NULL OR TRUE)
    )
    SELECT * FROM exempt
    WHERE ${COMMON_FILTERS}
    ORDER BY last_name, first_name, learner_id, income_name
  `;
}

function toRow(row: Record<string, unknown>): ExpectedFeeRow {
  const id = (value: unknown) => (value === null || value === undefined ? null : Number(value));
  const money = (value: unknown) => (value === null || value === undefined ? null : String(value));
  return {
    learner_id: String(row.learner_id),
    first_name: String(row.first_name),
    last_name: String(row.last_name),
    class_category_id: id(row.class_category_id),
    class_name: (row.class_name as string | null) ?? null,
    income_category_id: Number(row.income_category_id),
    income_name: String(row.income_name),
    priority: row.priority as ExpectedFeeRow["priority"],
    payment_period_id: id(row.payment_period_id),
    period_name: (row.period_name as string | null) ?? null,
    academic_year_id: id(row.academic_year_id),
    academic_year_name: (row.academic_year_name as string | null) ?? null,
    decision: row.decision as ExpectedFeeDecision,
    amount: money(row.amount),
    paid: money(row.paid) ?? "0",
    source: (row.source as ExpectedFeeRow["source"]) ?? null,
    reason: (row.reason as string | null) ?? null,
    decided_by: (row.decided_by as string | null) ?? null,
    decided_at: row.decided_at instanceof Date ? row.decided_at.toISOString() : ((row.decided_at as string | null) ?? null),
    can_undo: Boolean(row.can_undo),
  };
}
