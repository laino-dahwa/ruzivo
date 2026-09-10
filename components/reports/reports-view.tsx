'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, CircleDollarSign, Download, FileText, Scale } from 'lucide-react';
import { useToast } from '../../app/components/hooks/use-toast';
import { useCurrentSchoolId } from '../../lib/client/current-school-id';
import { currentAcademicYear } from '../../lib/client/current-academic-year';
import { formatCurrency } from '../../lib/currency';
import { reportsApi } from '../../services/reports';
import type { ReportType } from '../../types/report';
import { useSchoolReferenceData } from '../reference-data/use-school-reference-data';
import { SectionHeading } from '../shared/section-heading';
import { MetricCard } from '../shared/metric-card';
import { NoSchoolNotice } from '../shared/no-school-notice';
import { ErrorNotice } from '../shared/error-notice';
import { CategoryBars, IncomeExpenseTrend } from './report-charts';
import { formatReportDate } from './report-format';

type RangeMode = 'day' | 'week' | 'period' | 'all';

const MODE_LABELS: Record<RangeMode, string> = {
  day: 'Day',
  week: 'Date range',
  period: 'Period',
  all: 'All time',
};

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function weekAgo() {
  const now = new Date();
  now.setDate(now.getDate() - 6);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function ReportsView() {
  const { schoolId } = useCurrentSchoolId();
  const { toast } = useToast();
  const ref = useSchoolReferenceData(schoolId);

  const [mode, setMode] = useState<RangeMode>('day');
  const [day, setDay] = useState(today);
  const [start, setStart] = useState(weekAgo);
  const [end, setEnd] = useState(today);
  const [periodId, setPeriodId] = useState('');
  const [downloading, setDownloading] = useState<ReportType | null>(null);
  const [downloadingFull, setDownloadingFull] = useState(false);

  // Dates a period report's expenses against the year in progress; the first
  // record in the list is the oldest year the school ever created.
  const academicYearId = currentAcademicYear(ref.academicYears.data)?.academic_year_id;

  const scope = useMemo(() => {
    if (mode === 'day') return { start: day, end: day };
    if (mode === 'week') return { start, end };
    if (mode === 'period') return { paymentPeriodId: periodId ? Number(periodId) : null, academicYearId: academicYearId ? Number(academicYearId) : null };
    return {};
  }, [mode, day, start, end, periodId, academicYearId]);

  // A range the user has not finished specifying would otherwise be sent as a
  // half-open window and quietly report the wrong figures.
  const incomplete =
    (mode === 'day' && !day) ||
    (mode === 'week' && (!start || !end)) ||
    (mode === 'period' && !periodId);
  const rangeInverted = mode === 'week' && !!start && !!end && start > end;

  const overviewQuery = useQuery({
    queryKey: ['report-overview', schoolId, scope],
    queryFn: () => reportsApi.overview(schoolId!, scope),
    enabled: !!schoolId && !incomplete && !rangeInverted,
  });

  const data = overviewQuery.data;
  const periodName = ref.paymentPeriods.data?.find((p) => String(p.payment_period_id) === periodId)?.period_name;

  const scopeLabel =
    mode === 'all' ? 'All time'
      : mode === 'day' ? formatReportDate(day)
        : mode === 'week' ? `${formatReportDate(start)} – ${formatReportDate(end)}`
          : periodName ?? 'Period';

  const download = async (type: ReportType) => {
    if (!schoolId || incomplete) return;
    setDownloading(type);
    try {
      await reportsApi.downloadScopedPdf(schoolId, type, scope, `${type}-${mode}-report.pdf`);
      toast({ title: 'PDF downloaded' });
    } catch (error) {
      toast({ title: 'Could not generate PDF', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setDownloading(null);
    }
  };

  const downloadFull = async () => {
    if (!schoolId || incomplete || rangeInverted) return;
    setDownloadingFull(true);
    try {
      await reportsApi.downloadFullReport(schoolId, scope, `financial-report-${mode}.pdf`);
      toast({ title: 'Report downloaded' });
    } catch (error) {
      toast({ title: 'Could not generate the report', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setDownloadingFull(false);
    }
  };

  const net = data?.summary.netPosition ?? 0;

  return (
    <>
      <SectionHeading
        eyebrow="Reports"
        title="Financial reports"
        detail="Income, expenses and what is still owed — for a single day, a range of dates, or one of the school's payment periods."
      />
      {!schoolId ? <NoSchoolNotice /> : (
        <>
          {/* Filters sit in one row above everything they govern. */}
          <div className="rounded-2xl border border-border/80 bg-card p-5">
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex rounded-lg border border-border p-1 text-xs font-semibold">
                {(Object.keys(MODE_LABELS) as RangeMode[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setMode(value)}
                    data-testid={`button-report-mode-${value}`}
                    className={`rounded-md px-3 py-1.5 ${mode === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                  >
                    {MODE_LABELS[value]}
                  </button>
                ))}
              </div>

              {mode === 'day' && (
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Date</label>
                  <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="field h-9 w-40 text-xs" data-testid="input-report-day" />
                </div>
              )}

              {mode === 'week' && (
                <>
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">From</label>
                    <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="field h-9 w-40 text-xs" data-testid="input-report-start" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">To</label>
                    <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="field h-9 w-40 text-xs" data-testid="input-report-end" />
                  </div>
                </>
              )}

              {mode === 'period' && (
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Payment period</label>
                  <select value={periodId} onChange={(e) => setPeriodId(e.target.value)} className="field h-9 w-44 text-xs" data-testid="select-report-period">
                    <option value="">Choose a period…</option>
                    {ref.paymentPeriods.data?.map((p) => <option key={p.payment_period_id} value={p.payment_period_id}>{p.period_name}</option>)}
                  </select>
                </div>
              )}

              {/* Grouped so the label and the button wrap together and stay
                  with the criteria they describe. */}
              <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
              <p className="text-xs font-semibold text-foreground" data-testid="text-report-scope">
                Showing: {scopeLabel}
              </p>
              <button
                type="button"
                onClick={downloadFull}
                disabled={downloadingFull || incomplete || rangeInverted}
                data-testid="button-download-full-report"
                className="button-lift flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-60"
              >
                <FileText size={14} />{downloadingFull ? 'Preparing…' : 'Download full report'}
              </button>
              </div>
            </div>

            {rangeInverted && (
              <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
                The start date is after the end date.
              </p>
            )}
            {incomplete && !rangeInverted && (
              <p className="mt-3 rounded-lg border border-dashed border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
                {mode === 'period' ? 'Choose a payment period to build the report.' : 'Choose a date to build the report.'}
              </p>
            )}
          </div>

          {!incomplete && !rangeInverted && (
            <>
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard label="Income" value={formatCurrency(data?.summary.totalPayments ?? 0)} note={scopeLabel} icon={ArrowDownLeft} />
                <MetricCard label="Expenses" value={formatCurrency(data?.summary.totalExpenses ?? 0)} note={scopeLabel} icon={ArrowUpRight} />
                <MetricCard label="Net income" value={formatCurrency(net)} note={net < 0 ? 'Spent more than received' : 'Income − expenses'} icon={Scale} />
                <MetricCard label="Owed" value={formatCurrency(data?.summary.totalOutstanding ?? 0)} note="Raised in this window" icon={CircleDollarSign} />
              </div>

              {data && !data.expensesScopedByPeriod && (
                <p className="mt-4 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
                  Expenses are not shown for this period: an expense records a date, not a payment period, and
                  “{periodName}” is not a calendar month, so there is no window to match it against.
                </p>
              )}
              {data?.expenseWindow && mode === 'period' && (
                <p className="mt-4 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
                  Payments and amounts owed are taken from the {periodName} billing period. Expenses carry no period,
                  so they cover {formatReportDate(data.expenseWindow.start)} – {formatReportDate(data.expenseWindow.end)}.
                </p>
              )}

              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                <CategoryBars
                  title="Income by category"
                  note="What the money received was paid towards."
                  data={data?.breakdown.incomeByCategory ?? []}
                  tone="income"
                  emptyMessage="No payments were received in this window."
                />
                <CategoryBars
                  title="Expenses by category"
                  note="What the money spent went on."
                  data={data?.breakdown.expensesByCategory ?? []}
                  tone="expenses"
                  emptyMessage="No expenses were recorded in this window."
                />
              </div>

              {/* A single day has nothing to trend against, so the chart only
                  appears once the window spans more than one day with data. */}
              {(data?.breakdown.daily.length ?? 0) > 1 && (
                <div className="mt-4">
                  <IncomeExpenseTrend data={data!.breakdown.daily} note="Each day in the window that had activity." />
                </div>
              )}

              <ReportTable
                title="Payments"
                total={data?.payments.total ?? 0}
                totalLabel="Total received"
                onDownload={() => download('payments')}
                downloading={downloading === 'payments'}
                loading={overviewQuery.isLoading}
                columns={['Date', 'Learner', 'Class', 'Income', 'Method', 'Amount']}
                emptyMessage="No payments in this window."
                rows={data?.payments.rows.map((row) => [
                  formatReportDate(row.paid_at_local),
                  `${row.first_name} ${row.last_name}`,
                  row.class_name,
                  row.income_name,
                  row.method_name,
                  formatCurrency(row.amount),
                ]) ?? []}
              />

              <ReportTable
                title="Expenses"
                total={data?.expenses.total ?? 0}
                totalLabel="Total spent"
                onDownload={() => download('expenses')}
                downloading={downloading === 'expenses'}
                loading={overviewQuery.isLoading}
                columns={['Date', 'Category', 'Description', 'Amount']}
                emptyMessage="No expenses in this window."
                rows={data?.expenses.rows.map((row) => [
                  formatReportDate(row.expense_date),
                  row.category_name,
                  row.description,
                  formatCurrency(row.amount),
                ]) ?? []}
              />

              <ReportTable
                title="Owing"
                total={data?.owing.total ?? 0}
                totalLabel="Total outstanding"
                onDownload={() => download('owing')}
                downloading={downloading === 'owing'}
                loading={overviewQuery.isLoading}
                columns={['Learner', 'Income', 'Period', 'Expected', 'Paid', 'Outstanding', 'Status']}
                emptyMessage="No unpaid fees were raised in this window."
                rows={data?.owing.rows.map((row) => [
                  `${row.first_name} ${row.last_name}`,
                  row.income_name,
                  row.period_name,
                  formatCurrency(row.expected),
                  formatCurrency(row.paid),
                  formatCurrency(row.balance),
                  row.status,
                ]) ?? []}
              />

              <ErrorNotice error={overviewQuery.error} />
            </>
          )}
        </>
      )}
    </>
  );
}

function ReportTable({
  title,
  columns,
  rows,
  total,
  totalLabel,
  emptyMessage,
  loading,
  downloading,
  onDownload,
}: {
  title: string;
  columns: string[];
  rows: string[][];
  total: number;
  totalLabel: string;
  emptyMessage: string;
  loading: boolean;
  downloading: boolean;
  onDownload: () => void;
}) {
  return (
    <div className="mt-4 rounded-2xl border border-border/80 bg-card p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <button
          type="button"
          onClick={onDownload}
          disabled={downloading}
          className="button-lift flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60"
        >
          <Download size={14} />{downloading ? 'Preparing…' : 'PDF'}
        </button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full text-left text-xs">
          <thead className="bg-secondary/60 text-[10px] uppercase text-muted-foreground">
            <tr>{columns.map((column) => <th key={column} className="px-3 py-2 font-semibold">{column}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {loading && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={columns.length}>Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={columns.length}>{emptyMessage}</td></tr>}
            {rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className={`px-3 py-2 ${cellIndex === row.length - 1 ? 'font-semibold tabular-nums' : ''}`}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-border/80 bg-secondary/30 font-semibold">
                <td className="px-3 py-2" colSpan={columns.length - 1}>{totalLabel}</td>
                <td className="px-3 py-2 tabular-nums">{formatCurrency(total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
