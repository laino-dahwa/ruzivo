import type { ObligationRow } from '../../types/payment';

/**
 * One learner's position across every fee the obligations engine says they
 * should be paying — mandatory fees always, optional fees once they have
 * opted in (repositories/payment/read/getObligations.ts). This is the same
 * data as the Expected fees page, added up per learner instead of listed
 * per fee and period.
 */
export type LearnerOwing = {
  learner_id: string;
  first_name: string;
  last_name: string;
  class_name: string;
  mandatoryOwing: number;
  optionalOwing: number;
  totalOwing: number;
  paid: number;
  /**
   * paid + totalOwing, so "Paid X of Y" and the progress bar always add up.
   * Not the sum of `expected`: a fee with no limit can be paid without
   * having an expected amount, which would put paid above it.
   */
  billed: number;
  /** The fee/period rows still outstanding, mandatory first. */
  outstanding: ObligationRow[];
};

export type LearnerOwingSort = 'most-owing' | 'name' | 'class';

export type PaymentProgress = 'NOTHING_PAID' | 'PART_PAID' | 'NEARLY_PAID' | 'PAID_UP';

/** At or above this share of what they were billed, a learner counts as nearly paid. */
const NEARLY_PAID_SHARE = 0.9;

export function groupObligationsByLearner(rows: ObligationRow[]): LearnerOwing[] {
  const byLearner = new Map<string, LearnerOwing>();

  for (const row of rows) {
    let learner = byLearner.get(row.learner_id);
    if (!learner) {
      learner = {
        learner_id: row.learner_id,
        first_name: row.first_name,
        last_name: row.last_name,
        class_name: row.class_name,
        mandatoryOwing: 0,
        optionalOwing: 0,
        totalOwing: 0,
        paid: 0,
        billed: 0,
        outstanding: [],
      };
      byLearner.set(row.learner_id, learner);
    }

    // `balance` is null for a fee with no limit — there is no real figure
    // to owe, so it adds nothing to what is owing (what was paid still counts).
    learner.paid += Number(row.paid ?? 0);

    const balance = Number(row.balance ?? 0);
    if (balance > 0) {
      if (row.priority === 'MANDATORY') learner.mandatoryOwing += balance;
      else learner.optionalOwing += balance;
      learner.totalOwing += balance;
      learner.outstanding.push(row);
    }
  }

  for (const learner of byLearner.values()) {
    learner.billed = learner.paid + learner.totalOwing;
    learner.outstanding.sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'MANDATORY' ? -1 : 1));
  }

  return [...byLearner.values()];
}

export function sortLearnerOwings(learners: LearnerOwing[], sort: LearnerOwingSort): LearnerOwing[] {
  const byName = (a: LearnerOwing, b: LearnerOwing) =>
    `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`);

  return [...learners].sort((a, b) => {
    if (sort === 'most-owing') return b.totalOwing - a.totalOwing || byName(a, b);
    if (sort === 'class') return a.class_name.localeCompare(b.class_name, undefined, { numeric: true }) || byName(a, b);
    return byName(a, b);
  });
}

export function paymentProgress(learner: Pick<LearnerOwing, 'totalOwing' | 'paid' | 'billed'>): PaymentProgress {
  if (learner.totalOwing <= 0) return 'PAID_UP';
  if (learner.paid <= 0) return 'NOTHING_PAID';
  if (learner.paid / learner.billed >= NEARLY_PAID_SHARE) return 'NEARLY_PAID';
  return 'PART_PAID';
}
