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

/**
 * Serialises concurrent payments for the same learner+fee+period so two
 * requests can't each read the same "remaining" and both be accepted. The
 * lock is transaction-scoped (released on commit/rollback) and keyed to the
 * limit unit, so unrelated payments are never blocked. Advisory locks are
 * used because there is no single row to lock — the balance is derived.
 */
async function lockLimitKey(client: PoolClient, key: LimitKey): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [keyString(key)]);
}

/** What has already been paid towards this fee for this learner/period/year. */
async function existingPaidFor(client: PoolClient, key: LimitKey): Promise<number> {
  const result = await client.query(
    `
    SELECT COALESCE(SUM(p.amount), 0) AS paid
    FROM charges c
    JOIN payment_allocations pa ON pa.charge_id = c.charge_id
    JOIN payments p ON p.payment_id = pa.payment_id
    WHERE c.learner_id = $1
      AND c.income_category_id = $2
      AND c.payment_period_id = $3
      AND c.academic_year_id = $4
    `,
    [key.learner_id, key.income_category_id, key.payment_period_id, key.academic_year_id]
  );

  return Number(result.rows[0]?.paid ?? 0);
}

/** null means no limit is configured for this fee, so nothing is enforced. */
async function limitFor(client: PoolClient, income_category_id: number): Promise<{ limit: number | null; income_name: string }> {
  const result = await client.query(
    `SELECT income_name, income_limit FROM income_categories WHERE income_category_id = $1`,
    [income_category_id]
  );

  const row = result.rows[0];
  return {
    limit: row?.income_limit === null || row?.income_limit === undefined ? null : Number(row.income_limit),
    income_name: row?.income_name ?? "this fee",
  };
}

async function periodNameFor(client: PoolClient, payment_period_id: number): Promise<string> {
  const result = await client.query(
    `SELECT period_name FROM payment_periods WHERE payment_period_id = $1`,
    [payment_period_id]
  );
  return result.rows[0]?.period_name ?? "this period";
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
  const violations: PaymentLimitViolation[] = [];
  // Running total of what this request has already committed to each key.
  const pending = new Map<string, number>();
  const alreadyLocked = new Set<string>();

  for (const [index, input] of inputs.entries()) {
    for (const line of input.income_categories) {
      const key = limitKeyOf(input, line.income_category_id);
      const id = keyString(key);

      if (!alreadyLocked.has(id)) {
        await lockLimitKey(client, key);
        alreadyLocked.add(id);
      }

      const { limit, income_name } = await limitFor(client, line.income_category_id);
      if (limit === null) {
        continue; // No limit configured for this fee — nothing to enforce.
      }

      const paidSoFar = (await existingPaidFor(client, key)) + (pending.get(id) ?? 0);
      const remaining = limit - paidSoFar;
      const amount = Number(line.amount);
      const periodName = await periodNameFor(client, key.payment_period_id);

      if (remaining <= 0) {
        violations.push({
          index,
          field: "amount",
          message: `Payment cannot be processed. The learner has already paid the full ${income_name} amount of ${formatCurrency(limit)} for ${periodName}.`,
        });
        continue;
      }

      if (amount > remaining) {
        violations.push({
          index,
          field: "amount",
          message: `Payment exceeds the remaining ${income_name} balance for ${periodName}. The learner has ${formatCurrency(remaining)} remaining to pay.`,
        });
        continue;
      }

      pending.set(id, (pending.get(id) ?? 0) + amount);
    }
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
        /*
         * 1. Create the charge
         */
        const chargeResult = await client.query(
          `
          INSERT INTO charges (
            learner_id,
            enrolment_id,
            income_category_id,
            payment_period_id,
            academic_year_id
          )
          VALUES ($1, $2, $3, $4, $5)
          RETURNING
            charge_id,
            learner_id,
            enrolment_id,
            income_category_id,
            payment_period_id,
            academic_year_id,
            created_at
          `,
          [
            payment.learner_id,
            payment.enrolment_id,
            incomeCategory.income_category_id,
            payment.payment_period_id,
            payment.academic_year_id,
          ]
        );

        const charge = chargeResult.rows[0];

        /*
         * 2. Create the payment
         */
        const paymentResult = await client.query(
          `
          INSERT INTO payments (
            amount,
            payment_method_id
          )
          VALUES ($1, $2)
          RETURNING
            payment_id,
            amount,
            payment_method_id,
            paid_at
          `,
          [
            incomeCategory.amount,
            payment.payment_method_id,
          ]
        );

        const paymentRow = paymentResult.rows[0];

        /*
         * 3. Allocate this payment to this charge
         */
        const allocationResult = await client.query(
          `
          INSERT INTO payment_allocations (
            payment_id,
            charge_id
          )
          VALUES ($1, $2)
          RETURNING
            allocation_id,
            payment_id,
            charge_id
          `,
          [
            paymentRow.payment_id,
            charge.charge_id,
          ]
        );

        const allocation = allocationResult.rows[0];

        /*
         * Keep the three related records together
         */
        results.push({
          charge,
          payment: paymentRow,
          allocation,
        });
      }
    }

    return results;
  });
}
