/**
 * What a report covers.
 *
 * Generalises the single `date` the reports started with: a day is simply a
 * range whose start and end are the same, so every existing caller keeps
 * working while a week or a whole period becomes expressible.
 *
 * `paymentPeriodId` scopes by the school's own period (the January/February/…
 * records fees are billed against) rather than by dates, which is how fees and
 * limits already work. Payments and owing reach it through `charges`; expenses
 * do not — see `expenseWindow` below.
 */
export type ReportScope = {
  /** Inclusive 'YYYY-MM-DD', or null for no lower bound. */
  start: string | null;
  /** Inclusive 'YYYY-MM-DD', or null for no upper bound. */
  end: string | null;
  paymentPeriodId: number | null;
};

export const ALL_DATES: ReportScope = { start: null, end: null, paymentPeriodId: null };

export function scopeForDate(date: string | null): ReportScope {
  return { start: date, end: date, paymentPeriodId: null };
}

/**
 * The four bound parameters every report query takes, in a fixed order, so the
 * predicates below can be pasted into any of them without renumbering.
 */
export function scopeParams(school_id: string, scope: ReportScope) {
  return [school_id, scope.start, scope.end, scope.paymentPeriodId] as const;
}

/**
 * Date predicate for a TIMESTAMPTZ column, compared in the school's reporting
 * timezone so "today" means the local day rather than the UTC one.
 * `$5` is the timezone name.
 */
export function timestampWindow(column: string): string {
  return `
    ($2::date IS NULL OR (${column} AT TIME ZONE $5)::date >= $2::date)
    AND ($3::date IS NULL OR (${column} AT TIME ZONE $5)::date <= $3::date)
  `;
}

/** Date predicate for a plain DATE column. */
export function dateWindow(column: string): string {
  return `
    ($2::date IS NULL OR ${column} >= $2::date)
    AND ($3::date IS NULL OR ${column} <= $3::date)
  `;
}

/** Period predicate, for the tables that reach a period through `charges`. */
export function periodFilter(column = 'c.payment_period_id'): string {
  return `($4::bigint IS NULL OR ${column} = $4::bigint)`;
}

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/**
 * Expenses carry no payment period — `expenses` has an `expense_date` and
 * nothing linking it to `payment_periods`. So when a report is scoped to a
 * period, the only honest way to scope its expenses is by the calendar month
 * that period names, inside the academic year it belongs to.
 *
 * Returns null when the period is not named after a month (a school running
 * terms or quarters), so the caller can say the expenses could not be scoped
 * rather than quietly reporting every expense the school has ever had.
 */
export function expenseWindowForPeriod(
  periodName: string,
  academicYearStart: string,
  academicYearEnd: string,
): { start: string; end: string } | null {
  const month = MONTHS.indexOf(periodName.trim().toLowerCase());
  if (month === -1) return null;

  const startYear = Number(academicYearStart.slice(0, 4));
  const endYear = Number(academicYearEnd.slice(0, 4));
  if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) return null;

  // An academic year may straddle two calendar years (e.g. September–June), so
  // the month is taken from whichever of them actually contains it.
  for (const year of startYear === endYear ? [startYear] : [startYear, endYear]) {
    const first = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    if (first >= academicYearStart.slice(0, 10) && first <= academicYearEnd.slice(0, 10)) {
      return { start: first, end: lastDayOfMonth(year, month) };
    }
  }

  // The month sits outside the year's span; fall back to the starting calendar
  // year so a report still shows something dated rather than nothing at all.
  return {
    start: `${startYear}-${String(month + 1).padStart(2, '0')}-01`,
    end: lastDayOfMonth(startYear, month),
  };
}

function lastDayOfMonth(year: number, month: number): string {
  const day = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
