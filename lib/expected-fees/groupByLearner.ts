import type { ExpectedFeeRow, FeeKey } from '../../types/expected-fees';

/**
 * One card on the Expected fees page: a learner's fees in the decision state
 * being viewed (pending by default), added up. Mandatory fees are split out
 * from optional and once-off ones, the same split the old Learner owings
 * cards made.
 */
export type ExpectedFeeCard = {
  learner_id: string;
  first_name: string;
  last_name: string;
  class_name: string;
  /** Sum of the rows' amounts. Pending: what accepting them all would add to the learner's balance. */
  total: number;
  mandatory: number;
  optional: number;
  /** Mandatory first, then by year, period and fee. */
  rows: ExpectedFeeRow[];
};

export type ExpectedFeeSort = 'largest' | 'name' | 'class';

export function groupExpectedFeesByLearner(rows: ExpectedFeeRow[]): ExpectedFeeCard[] {
  const byLearner = new Map<string, ExpectedFeeCard>();

  for (const row of rows) {
    let card = byLearner.get(row.learner_id);
    if (!card) {
      card = {
        learner_id: row.learner_id,
        first_name: row.first_name,
        last_name: row.last_name,
        class_name: row.class_name ?? '',
        total: 0,
        mandatory: 0,
        optional: 0,
        rows: [],
      };
      byLearner.set(row.learner_id, card);
    }

    const amount = Number(row.amount ?? 0);
    card.total += amount;
    if (row.priority === 'MANDATORY') card.mandatory += amount;
    else card.optional += amount;
    card.rows.push(row);
  }

  for (const card of byLearner.values()) {
    card.rows.sort((a, b) =>
      Number(b.priority === 'MANDATORY') - Number(a.priority === 'MANDATORY')
      || (a.academic_year_name ?? '').localeCompare(b.academic_year_name ?? '')
      || (a.payment_period_id ?? 0) - (b.payment_period_id ?? 0)
      || a.income_name.localeCompare(b.income_name));
  }

  return [...byLearner.values()];
}

export function sortExpectedFeeCards(cards: ExpectedFeeCard[], sort: ExpectedFeeSort): ExpectedFeeCard[] {
  const byName = (a: ExpectedFeeCard, b: ExpectedFeeCard) =>
    `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`);

  return [...cards].sort((a, b) => {
    if (sort === 'largest') return b.total - a.total || byName(a, b);
    if (sort === 'class') return a.class_name.localeCompare(b.class_name, undefined, { numeric: true }) || byName(a, b);
    return byName(a, b);
  });
}

/** The key an accept/deny-for-this-period/undo request names a row by; null for an exemption row. */
export function feeKeyOf(row: ExpectedFeeRow): FeeKey | null {
  if (row.payment_period_id === null || row.academic_year_id === null) return null;
  return {
    learner_id: row.learner_id,
    income_category_id: row.income_category_id,
    payment_period_id: row.payment_period_id,
    academic_year_id: row.academic_year_id,
  };
}

/** Stable React key / selection id for a row. */
export function rowId(row: ExpectedFeeRow): string {
  return [row.decision, row.learner_id, row.income_category_id, row.payment_period_id ?? '-', row.academic_year_id ?? '-'].join('|');
}
