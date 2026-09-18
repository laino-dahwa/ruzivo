import type { DailyTotal, OwingReportRow } from "../../types/report";

/** Above this many points, a bar per day stops being readable. */
const DAILY_BAR_LIMIT = 62;

/**
 * Rolls a daily series up into months once the window is long enough that a
 * bar per day would be unreadable — a year is 365 bars in a card a few
 * hundred pixels wide.
 *
 * Done here rather than in SQL because the same response also feeds the
 * headline figures, which are not bucketed, and a second query for the chart
 * could describe a slightly different window.
 */
export function rollUpDaily(daily: DailyTotal[]): DailyTotal[] {
  if (daily.length <= DAILY_BAR_LIMIT) {
    return daily;
  }

  const months = new Map<string, DailyTotal>();

  for (const day of daily) {
    const month = day.date.slice(0, 7);
    const existing = months.get(month);

    if (existing) {
      existing.income += day.income;
      existing.expenses += day.expenses;
    } else {
      // Dated to the first of the month so the axis formatter still parses it
      // as a date rather than being handed "2026-03".
      months.set(month, { date: `${month}-01`, income: day.income, expenses: day.expenses });
    }
  }

  return [...months.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export type Debtor = {
  learner_id: string;
  name: string;
  class_name: string;
  balance: number;
  fees: number;
};

/**
 * Who owes the most, totalled per learner rather than per charge.
 *
 * The owing report has one row per unpaid fee, so a learner behind on three
 * fees appears three times. Ranking those rows directly would put a learner
 * owing one large fee above a learner owing more in total across several —
 * which is the opposite of who needs chasing first.
 */
export function topDebtors(rows: OwingReportRow[]): Debtor[] {
  const byLearner = new Map<string, Debtor>();

  for (const row of rows) {
    const balance = Number(row.balance ?? 0);
    const existing = byLearner.get(row.learner_id);

    if (existing) {
      existing.balance += balance;
      existing.fees += 1;
    } else {
      byLearner.set(row.learner_id, {
        learner_id: row.learner_id,
        name: `${row.first_name} ${row.last_name}`,
        class_name: row.class_name,
        balance,
        fees: 1,
      });
    }
  }

  return [...byLearner.values()].sort((a, b) => b.balance - a.balance);
}
