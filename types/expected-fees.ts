/**
 * Expected fees: suggestions the system makes about what a learner should be
 * paying, which someone accepts (it becomes a balance) or denies. Shared by
 * the API (repositories/expected-fees/) and the page (components/expected-fees/).
 */

export type FeePriority = 'MANDATORY' | 'OPTIONAL' | 'ONCE_OFF';

/**
 * PENDING  - suggested, nobody has acted on it.
 * ACCEPTED - owed; it is on Balances.
 * SKIPPED  - denied for this period only.
 * EXEMPT   - denied forever: never suggested for this learner again.
 */
export type ExpectedFeeDecision = 'PENDING' | 'ACCEPTED' | 'SKIPPED' | 'EXEMPT';

export const EXPECTED_FEE_DECISIONS: readonly ExpectedFeeDecision[] = ['PENDING', 'ACCEPTED', 'SKIPPED', 'EXEMPT'];

export function isExpectedFeeDecision(value: unknown): value is ExpectedFeeDecision {
  return typeof value === 'string' && (EXPECTED_FEE_DECISIONS as readonly string[]).includes(value);
}

/** One learner + fee + period + academic year: the unit a fee is owed in. */
export type FeeKey = {
  learner_id: string;
  income_category_id: number;
  payment_period_id: number;
  academic_year_id: number;
};

/** An exemption covers a fee in every period and year. */
export type ExemptionKey = {
  learner_id: string;
  income_category_id: number;
};

/** One row from GET /api/schools/:school_id/expected-fees. */
export type ExpectedFeeRow = {
  learner_id: string;
  first_name: string;
  last_name: string;
  /** The class for this row's academic year (an exemption: the learner's latest class). */
  class_category_id: number | null;
  class_name: string | null;
  income_category_id: number;
  income_name: string;
  priority: FeePriority;
  /** Null only for EXEMPT rows, which cover every period and year. */
  payment_period_id: number | null;
  period_name: string | null;
  academic_year_id: number | null;
  academic_year_name: string | null;
  decision: ExpectedFeeDecision;
  /**
   * PENDING: the amount that would be owed on accepting it.
   * ACCEPTED: the amount owed (fixed when it was accepted).
   * SKIPPED / EXEMPT: the fee's current amount, for reference.
   */
  amount: string | null;
  /** Paid so far. Only ever above zero for ACCEPTED rows. */
  paid: string;
  /** How an ACCEPTED row was accepted: by someone pressing Accept, or by recording a payment. */
  source: 'DECISION' | 'PAYMENT' | null;
  /** Why it was denied forever (EXEMPT only). */
  reason: string | null;
  decided_by: string | null;
  decided_at: string | null;
  /** Whether the decision can be undone: an accepted fee only while nothing is paid toward it. */
  can_undo: boolean;
};

export type ExpectedFeeFilters = {
  decision?: ExpectedFeeDecision | null;
  class_category_id?: number | null;
  learner_id?: string | null;
  income_category_id?: number | null;
  priority?: FeePriority | null;
  academic_year_id?: number | null;
  payment_period_id?: number | null;
};

/**
 * What POST /api/schools/:school_id/expected-fees/decisions accepts.
 *
 * ACCEPT / SKIP act only on fees that are still pending when the request
 * arrives; anything decided or paid in the meantime is left alone and
 * counted in `unchanged`.
 */
export type ExpectedFeeAction =
  | { action: 'ACCEPT'; items: FeeKey[] }
  | { action: 'SKIP'; items: FeeKey[] }
  | { action: 'EXEMPT'; items: ExemptionKey[]; reason: string }
  | { action: 'UNDO_ACCEPT'; items: FeeKey[] }
  | { action: 'UNDO_SKIP'; items: FeeKey[] }
  | { action: 'RESTORE'; items: ExemptionKey[] };

export type ExpectedFeeActionResult = {
  /** How many fees (or exemptions) the action changed. */
  changed: number;
  /** How many it left alone, because they were no longer in the state the action applies to. */
  unchanged: number;
  /** For ACCEPT: the total newly owed. */
  amount: number;
};
