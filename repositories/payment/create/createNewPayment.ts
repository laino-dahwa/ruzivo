import type { PoolClient } from "pg";
import { transaction } from "../../../lib/db";
import { formatCurrency } from "../../../lib/currency";

export type CreateChargesWithPaymentsInput = {
  learner_id: string;
  enrolment_id: number;
  payment_period_id: number;
  academic_year_id: number;
  payment_method_id: number;

  income_categories: {
    income_category_id: number;
    amount: number;
  }[];
};

export type PaymentLimitViolation = {
  index: number;
  field: string;
  message: string;
};

/**
 * Raised when a payment would push a learner past the fee limit for a period.
 * Carries per-record detail so the route can answer with a 400 in the same
 * shape as the other validation failures, rather than a generic 500.
 */
export class PaymentLimitError extends Error {
  readonly violations: PaymentLimitViolation[];

  constructor(violations: PaymentLimitViolation[]) {
    super(violations[0]?.message ?? "Payment exceeds the amount owing.");
    this.name = "PaymentLimitError";
    this.violations = violations;
  }
}

/**
 * Raised when a payment targets a soft-deleted learner. The learner picker
 * already excludes archived learners, so this only fires against a stale
 * client or a direct API call — but it must still be refused here, since
 * that is the one place a charge can actually be created.
 */
export class DeletedLearnerError extends Error {
  readonly learnerIds: string[];

  constructor(learnerIds: string[]) {
    super(`Cannot record a payment for an archived learner: ${learnerIds.join(", ")}`);
    this.name = "DeletedLearnerError";
    this.learnerIds = learnerIds;
  }
}

async function assertLearnersActive(client: PoolClient, inputs: CreateChargesWithPaymentsInput[]): Promise<void> {
  const learnerIds = [...new Set(inputs.map((input) => input.learner_id))];

  const result = await client.query(
    `SELECT learner_id FROM learners WHERE learner_id = ANY($1::varchar[]) AND deleted_at IS NOT NULL`,
    [learnerIds]
  );

  if (result.rows.length > 0) {
    throw new DeletedLearnerError(result.rows.map((row) => row.learner_id));
  }
}

/**
 * The unit a fee limit applies to. `income_categories.income_limit` is the
 * amount owed for one fee, for one learner, in one payment period of one
 * academic year — which is exactly how getBalances/getOwingReport already
 * compute "charged" vs "paid". Enforcement uses the same key so the limit
 * being enforced is the same number the balance screens display.
 *
 * A ONCE_OFF fee uses the same key. It is not set up for particular periods -
 * it can be paid in any of them - but whatever period it is paid in, the limit
 * applies to that period alone: 5 of 20 paid in January leaves 15 owing for
 * January, and paying it in June starts June's own 20. With no limit set it
 * can be paid one time per period.
 */
type LimitKey = {
  learner_id: string;
  income_category_id: number;
  payment_period_id: number;
  academic_year_id: number;
};

function limitKeyOf(input: CreateChargesWithPaymentsInput, income_category_id: number): LimitKey {
  return {
    learner_id: input.learner_id,
    income_category_id,
    payment_period_id: input.payment_period_id,
    academic_year_id: input.academic_year_id,
  };
}

function keyString(key: LimitKey): string {
  return `${key.learner_id}|${key.income_category_id}|${key.payment_period_id}|${key.academic_year_id}`;
}

/*
 * Everything assertWithinLimits needs to know is loaded up front, a handful
 * of queries for the whole request, rather than several queries per payment
 * line. Each line used to cost ~7 sequential round trips inside the open
 * transaction, so a multi-learner batch spent most of its time waiting on
 * the database one query at a time.
 */

type IncomeRule = { limit: number | null; income_name: string; onceOff: boolean };

/** `limit` null means no limit is configured for this fee. */
async function loadIncomeRules(client: PoolClient, incomeCategoryIds: number[]): Promise<Map<string, IncomeRule>> {
  const result = await client.query(
    `SELECT income_category_id, income_name, income_limit, priority FROM income_categories WHERE income_category_id = ANY($1::bigint[])`,
    [incomeCategoryIds]
  );

  return new Map(result.rows.map((row) => [String(row.income_category_id), {
    limit: row.income_limit === null || row.income_limit === undefined ? null : Number(row.income_limit),
    income_name: row.income_name ?? "this fee",
    onceOff: row.priority === "ONCE_OFF",
  }]));
}

/** Used when a fee id matches no row, the same fallback as before. */
const UNKNOWN_INCOME: IncomeRule = { limit: null, income_name: "this fee", onceOff: false };

async function loadPeriodNames(client: PoolClient, paymentPeriodIds: number[]): Promise<Map<string, string>> {
  const result = await client.query(
    `SELECT payment_period_id, period_name FROM payment_periods WHERE payment_period_id = ANY($1::bigint[])`,
    [paymentPeriodIds]
  );
  return new Map(result.rows.map((row) => [String(row.payment_period_id), String(row.period_name)]));
}

function appliesKey(income_category_id: number, input: CreateChargesWithPaymentsInput): string {
  return `${income_category_id}|${input.enrolment_id}|${input.learner_id}`;
}

/**
 * Whether each once-off fee applies to the learner it is being paid for:
 * everyone, the learner's class (as enrolled for this payment), or the
 * learner by name. Once-off fees are never projected as owed, so this is the
 * one place their "Applies to" takes effect. Keyed by appliesKey().
 */
async function loadOnceOffApplicability(
  client: PoolClient,
  lines: { income_category_id: number; input: CreateChargesWithPaymentsInput }[]
): Promise<Set<string>> {
  if (lines.length === 0) return new Set();

  const result = await client.query(
    `
    SELECT k.key
    FROM unnest($1::text[], $2::bigint[], $3::bigint[], $4::varchar[])
      AS k(key, income_category_id, enrolment_id, learner_id)
    JOIN income_categories ic ON ic.income_category_id = k.income_category_id
    WHERE CASE ic.class_applicability
      WHEN 'ALL_LEARNERS' THEN TRUE
      WHEN 'SPECIFIC_CLASSES' THEN EXISTS (
        SELECT 1 FROM income_category_classes icc
        JOIN enrolments e ON e.class_category_id = icc.class_category_id
        WHERE icc.income_category_id = ic.income_category_id AND e.enrolment_id = k.enrolment_id
      )
      WHEN 'SPECIFIC_LEARNERS' THEN EXISTS (
        SELECT 1 FROM income_category_learners icl
        WHERE icl.income_category_id = ic.income_category_id AND icl.learner_id = k.learner_id
      )
      ELSE FALSE
    END
    `,
    [
      lines.map((line) => appliesKey(line.income_category_id, line.input)),
      lines.map((line) => line.income_category_id),
      lines.map((line) => line.input.enrolment_id),
      lines.map((line) => line.input.learner_id),
    ]
  );
  return new Set(result.rows.map((row) => String(row.key)));
}

/**
 * Serialises concurrent payments for the same learner+fee+period so two
 * requests can't each read the same "remaining" and both be accepted. The
 * locks are transaction-scoped (released on commit/rollback) and keyed to
 * the limit unit, so unrelated payments are never blocked. Advisory locks are
 * used because there is no single row to lock — the balance is derived.
 *
 * Every key is taken in one statement, in a fixed (sorted) order, so two
 * batches touching the same keys can't deadlock by locking them in opposite
 * orders.
 */
async function lockLimitKeys(client: PoolClient, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const sorted = [...new Set(keys)].sort();
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended(k.key, 0)) FROM unnest($1::text[]) WITH ORDINALITY AS k(key, ord) ORDER BY k.ord`,
    [sorted]
  );
}

/**
 * What has already been paid towards each fee for each learner/period/year,
 * keyed by keyString(). Must run after lockLimitKeys, so the totals can't
 * change before this request's payments are written.
 */
async function loadExistingPaid(client: PoolClient, keys: LimitKey[]): Promise<Map<string, number>> {
  if (keys.length === 0) return new Map();

  const result = await client.query(
    `
    SELECT k.key, COALESCE(SUM(p.amount), 0) AS paid
    FROM unnest($1::text[], $2::varchar[], $3::bigint[], $4::bigint[], $5::bigint[])
      AS k(key, learner_id, income_category_id, payment_period_id, academic_year_id)
    LEFT JOIN charges c
      ON c.learner_id = k.learner_id
      AND c.income_category_id = k.income_category_id
      AND c.payment_period_id = k.payment_period_id
      AND c.academic_year_id = k.academic_year_id
    LEFT JOIN payment_allocations pa ON pa.charge_id = c.charge_id
    LEFT JOIN payments p ON p.payment_id = pa.payment_id
    GROUP BY k.key
    `,
    [
      keys.map(keyString),
      keys.map((key) => key.learner_id),
      keys.map((key) => key.income_category_id),
      keys.map((key) => key.payment_period_id),
      keys.map((key) => key.academic_year_id),
    ]
  );
  return new Map(result.rows.map((row) => [String(row.key), Number(row.paid)]));
}

/**
 * Checks every payment line in the request against what the learner has
 * already paid, accumulating as it goes so several lines in one request can't
 * collectively exceed the limit even though each would pass on its own.
 *
 * Collects every violation rather than stopping at the first, so a bulk
 * submission reports all of its problems at once.
 */
async function assertWithinLimits(client: PoolClient, inputs: CreateChargesWithPaymentsInput[]): Promise<void> {
  const allLines = inputs.flatMap((input, index) => input.income_categories.map((line) => ({ index, input, line })));
  if (allLines.length === 0) return;

  const rules = await loadIncomeRules(client, [...new Set(allLines.map(({ line }) => line.income_category_id))]);
  const ruleFor = (income_category_id: number) => rules.get(String(income_category_id)) ?? UNKNOWN_INCOME;
  const periodNames = await loadPeriodNames(client, [...new Set(inputs.map((input) => input.payment_period_id))]);

  const lines = allLines.map((entry) => ({ ...entry, key: limitKeyOf(entry.input, entry.line.income_category_id) }));
  const uniqueKeys = [...new Map(lines.map(({ key }) => [keyString(key), key])).values()];

  const onceOffLines = lines.filter(({ line }) => ruleFor(line.income_category_id).onceOff);
  const applicable = await loadOnceOffApplicability(
    client,
    onceOffLines.map(({ line, input }) => ({ income_category_id: line.income_category_id, input }))
  );

  await lockLimitKeys(client, uniqueKeys.map(keyString));
  const existingPaid = await loadExistingPaid(client, uniqueKeys);

  const violations: PaymentLimitViolation[] = [];
  // Running total of what this request has already committed to each key.
  const pending = new Map<string, number>();

  for (const { index, input, line, key } of lines) {
    const { limit, income_name, onceOff } = ruleFor(line.income_category_id);
    const id = keyString(key);
    const amount = Number(line.amount);
    const scope = `for ${periodNames.get(String(input.payment_period_id)) ?? "this period"}`;

    if (onceOff) {
      // Payable in any period (each with its own limit); only who it
      // applies to needs checking here.
      if (!applicable.has(appliesKey(line.income_category_id, input))) {
        violations.push({
          index,
          field: "income_category_id",
          message: `${income_name} does not apply to this learner.`,
        });
        continue;
      }
    }

    if (limit === null) {
      // No limit configured. A regular fee then has nothing to enforce; a
      // once-off fee with no set amount is still paid one time per period.
      if (onceOff) {
        const paidAlready = (existingPaid.get(id) ?? 0) + (pending.get(id) ?? 0);
        if (paidAlready > 0) {
          violations.push({
            index,
            field: "amount",
            message: `Payment cannot be processed. ${income_name} is a once-off payment and the learner has already paid it ${scope}.`,
          });
          continue;
        }
        pending.set(id, amount);
      }
      continue;
    }

    const paidSoFar = (existingPaid.get(id) ?? 0) + (pending.get(id) ?? 0);
    const remaining = limit - paidSoFar;

    if (remaining <= 0) {
      violations.push({
        index,
        field: "amount",
        message: `Payment cannot be processed. The learner has already paid the full ${income_name} amount of ${formatCurrency(limit)} ${scope}.`,
      });
      continue;
    }

    if (amount > remaining) {
      violations.push({
        index,
        field: "amount",
        message: `Payment exceeds the remaining ${income_name} balance ${scope}. The learner has ${formatCurrency(remaining)} remaining to pay.`,
      });
      continue;
    }

    pending.set(id, (pending.get(id) ?? 0) + amount);
  }

  if (violations.length > 0) {
    throw new PaymentLimitError(violations);
  }
}

/**
 * Records one or many payments. A "payment" is three rows — a charge, the
 * payment itself, and the allocation linking them — so the whole batch runs
 * inside a single transaction: either every charge/payment/allocation in the
 * request is written, or none is. Partial writes here would leave money
 * recorded against no charge (or a charge with no payment), which every
 * balance and report is derived from.
 *
 * Accepts a single input object or an array of them; the flat result array
 * (one entry per income category across all inputs) is the same shape either
 * way.
 */
export async function createChargesWithPayments(
  input: CreateChargesWithPaymentsInput | CreateChargesWithPaymentsInput[]
) {
  const inputs = Array.isArray(input) ? input : [input];

  const hasWork = inputs.some(
    (entry) => entry.income_categories.length > 0
  );

  if (!hasWork) {
    return [];
  }

  return transaction(async (client) => {
    // Runs inside the same transaction as the inserts, so a learner cannot
    // be deleted between this check and the charge/payment rows being written.
    await assertLearnersActive(client, inputs);

    // Runs inside the same transaction as the inserts, so the balance a
    // payment is validated against cannot change before it is written.
    await assertWithinLimits(client, inputs);

    const results = [];

    for (const payment of inputs) {
      for (const incomeCategory of payment.income_categories) {
        // The charge, the payment and the allocation linking them, written
        // in one statement (one round trip) rather than three. Columns are
        // selected individually, not as row_to_json, so every value keeps
        // the exact type pg gave it before (bigint ids as strings, dates as
        // Date) and the API response is unchanged.
        const { rows: [row] } = await client.query(
          `
          WITH c AS (
            INSERT INTO charges (
              learner_id,
              enrolment_id,
              income_category_id,
              payment_period_id,
              academic_year_id
            )
            VALUES ($1, $2, $3, $4, $5)
            RETURNING charge_id, learner_id, enrolment_id, income_category_id, payment_period_id, academic_year_id, created_at
          ),
          p AS (
            INSERT INTO payments (
              amount,
              payment_method_id
            )
            VALUES ($6, $7)
            RETURNING payment_id, amount, payment_method_id, paid_at
          ),
          a AS (
            INSERT INTO payment_allocations (
              payment_id,
              charge_id
            )
            SELECT p.payment_id, c.charge_id FROM p, c
            RETURNING allocation_id, payment_id, charge_id
          )
          SELECT
            c.charge_id, c.learner_id, c.enrolment_id, c.income_category_id, c.payment_period_id, c.academic_year_id, c.created_at,
            p.payment_id, p.amount, p.payment_method_id, p.paid_at,
            a.allocation_id
          FROM c, p, a
          `,
          [
            payment.learner_id,
            payment.enrolment_id,
            incomeCategory.income_category_id,
            payment.payment_period_id,
            payment.academic_year_id,
            incomeCategory.amount,
            payment.payment_method_id,
          ]
        );

        /*
         * Keep the three related records together
         */
        results.push({
          charge: {
            charge_id: row.charge_id,
            learner_id: row.learner_id,
            enrolment_id: row.enrolment_id,
            income_category_id: row.income_category_id,
            payment_period_id: row.payment_period_id,
            academic_year_id: row.academic_year_id,
            created_at: row.created_at,
          },
          payment: {
            payment_id: row.payment_id,
            amount: row.amount,
            payment_method_id: row.payment_method_id,
            paid_at: row.paid_at,
          },
          allocation: {
            allocation_id: row.allocation_id,
            payment_id: row.payment_id,
            charge_id: row.charge_id,
          },
        });
      }
    }

    return results;
  });
}
