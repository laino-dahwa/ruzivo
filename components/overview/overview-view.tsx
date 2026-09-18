'use client';

import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowDownLeft, ArrowUpRight, Scale, Wallet } from 'lucide-react';
import { useCurrentSchoolId } from '../../lib/client/current-school-id';
import { reportsApi } from '../../services/reports';
import { formatCurrency } from '../../lib/currency';
import { rollUpDaily, topDebtors } from '../../lib/overview/summarise';
import { SectionHeading } from '../shared/section-heading';
import { MetricCard } from '../shared/metric-card';
import { NoSchoolNotice } from '../shared/no-school-notice';
import { ErrorNotice } from '../shared/error-notice';
import { CategoryBars, IncomeExpenseTrend } from '../reports/report-charts';
import { CollectionMeter } from './collection-meter';

type WindowKey = 'month' | 'year' | 'all';

const WINDOWS: { key: WindowKey; label: string }[] = [
  { key: 'month', label: 'This month' },
  { key: 'year', label: 'This year' },
  { key: 'all', label: 'All time' },
];

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** No start/end at all means "all dates" to the reports API. */
function scopeFor(key: WindowKey): { start?: string; end?: string } {
  const now = new Date();
  if (key === 'month') {
    return { start: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), end: isoDate(now) };
  }
  if (key === 'year') {
    return { start: `${now.getFullYear()}-01-01`, end: isoDate(now) };
  }
  return {};
}

export function OverviewView() {
  const { schoolId } = useCurrentSchoolId();
  const [window, setWindow] = useState<WindowKey>('month');

  const overview = useQuery({
    queryKey: ['overview', schoolId, window],
    queryFn: () => reportsApi.overview(schoolId!, scopeFor(window)),
    enabled: !!schoolId,
    // Holds the previous window's figures while the new one loads, so
    // switching does not blank the page and jump the layout.
    placeholderData: keepPreviousData,
  });

  const data = overview.data;
  const summary = data?.summary;

  const debtors = useMemo(() => topDebtors(data?.owing.rows ?? []), [data?.owing.rows]);
  const trend = useMemo(() => rollUpDaily(data?.breakdown.daily ?? []), [data?.breakdown.daily]);

  const windowLabel = WINDOWS.find((entry) => entry.key === window)?.label.toLowerCase() ?? '';

  return (
    <>
      <SectionHeading
        eyebrow="Overview"
        title="School at a glance"
        detail="Money in, money owed, and where it is going. Every figure below covers the same window."
      />

      {!schoolId ? <NoSchoolNotice /> : (
        <>
          {/* One filter row above everything it scopes, so every card on the
              page is always describing the same window. */}
          <div className="flex items-center gap-1 rounded-xl border border-border/80 bg-card p-1" role="group" aria-label="Reporting window">
            {WINDOWS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => setWindow(entry.key)}
                aria-pressed={window === entry.key}
                className={`h-8 flex-1 rounded-lg text-xs font-semibold transition-colors ${
                  window === entry.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'
                }`}
                data-testid={`button-window-${entry.key}`}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <ErrorNotice error={overview.error} />

          {/* Reduced opacity while refetching rather than a skeleton, so
              nothing shifts underneath the reader. */}
          <div className={overview.isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Collected"
                value={formatCurrency(summary?.totalPayments ?? 0)}
                note={`${data?.payments.rows.length ?? 0} payments ${windowLabel}`}
                icon={ArrowDownLeft}
              />
              <MetricCard
                label="Still owed"
                value={formatCurrency(summary?.totalOutstanding ?? 0)}
                note={`${debtors.length} learners owing`}
                icon={Scale}
              />
              <MetricCard
                label="Expenses"
                value={formatCurrency(summary?.totalExpenses ?? 0)}
                note={`${data?.expenses.rows.length ?? 0} recorded ${windowLabel}`}
                icon={ArrowUpRight}
              />
              <MetricCard
                label="Net position"
                value={formatCurrency(summary?.netPosition ?? 0)}
                note={(summary?.netPosition ?? 0) >= 0 ? 'Collected more than spent' : 'Spent more than collected'}
                icon={Wallet}
              />
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
              <CollectionMeter collected={summary?.totalPayments ?? 0} outstanding={summary?.totalOutstanding ?? 0} />

              <IncomeExpenseTrend
                data={trend}
                note={
                  trend.length > 0 && trend.length !== (data?.breakdown.daily.length ?? 0)
                    ? 'Grouped by month — a bar per day is unreadable across a window this long.'
                    : undefined
                }
              />
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <CategoryBars
                title="Where the money came from"
                note="Payments received, by fee."
                data={data?.breakdown.incomeByCategory ?? []}
                tone="income"
                emptyMessage="No payments were received in this window."
              />
              <CategoryBars
                title="Where the money went"
                note="Expenses recorded, by category."
                data={data?.breakdown.expensesByCategory ?? []}
                tone="expenses"
                emptyMessage="No expenses were recorded in this window."
              />
            </div>

            <div className="mt-6 rounded-2xl border border-border/80 bg-card p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold">Who owes the most</h3>
                  <p className="mt-1 text-[11px] text-muted-foreground">Totalled per learner across every unpaid fee in this window.</p>
                </div>
                <Link href="/owing" className="shrink-0 text-[11px] font-semibold text-primary hover:underline">See all balances →</Link>
              </div>

              {debtors.length === 0 ? (
                <p className="mt-4 rounded-lg border border-dashed border-border bg-secondary/30 px-3 py-6 text-center text-xs text-muted-foreground">
                  Nothing outstanding in this window.
                </p>
              ) : (
                <div className="mt-4 overflow-x-auto rounded-lg border border-border/60">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-secondary/60 text-[10px] uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Learner</th>
                        <th className="px-3 py-2 font-semibold">Class</th>
                        <th className="px-3 py-2 font-semibold">Unpaid fees</th>
                        <th className="px-3 py-2 text-right font-semibold">Owing</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {debtors.slice(0, 6).map((debtor) => (
                        <tr key={debtor.learner_id} data-testid={`row-debtor-${debtor.learner_id}`}>
                          <td className="px-3 py-2 font-medium">{debtor.name}</td>
                          <td className="px-3 py-2 text-muted-foreground">{debtor.class_name}</td>
                          <td className="px-3 py-2 text-muted-foreground">{debtor.fees}</td>
                          {/* tabular-nums here, where the figures align down a column. */}
                          <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatCurrency(debtor.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {debtors.length > 6 && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Showing the 6 largest of {debtors.length} learners with an outstanding balance.
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
