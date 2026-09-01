'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, CircleDollarSign, Download, FileBarChart } from 'lucide-react';
import { useToast } from '../../app/components/hooks/use-toast';
import { useCurrentSchoolId } from '../../lib/client/current-school-id';
import { formatCurrency } from '../../lib/currency';
import { reportsApi } from '../../services/reports';
import type { ReportDate, ReportType } from '../../types/report';
import { SectionHeading } from '../shared/section-heading';
import { MetricCard } from '../shared/metric-card';
import { NoSchoolNotice } from '../shared/no-school-notice';
import { ErrorNotice } from '../shared/error-notice';
import { REPORT_TYPE_LABELS, formatReportDate } from './report-format';

export function ReportsView() {
  const { schoolId } = useCurrentSchoolId();
  const { toast } = useToast();
  const [reportType, setReportType] = useState<ReportType>('payments');
  const [dateMode, setDateMode] = useState<'specific' | 'all'>('all');
  const [specificDate, setSpecificDate] = useState('');
  const [downloading, setDownloading] = useState(false);

  const date: ReportDate = dateMode === 'specific' && specificDate ? specificDate : null;
  const waitingForDate = dateMode === 'specific' && !specificDate;
  const queriesEnabled = !!schoolId && !waitingForDate;

  const summaryQuery = useQuery({
    queryKey: ['reports-summary', schoolId, date],
    queryFn: () => reportsApi.summary(schoolId!, date),
    enabled: queriesEnabled,
  });
  const paymentsQuery = useQuery({
    queryKey: ['reports-payments', schoolId, date],
    queryFn: () => reportsApi.payments(schoolId!, date),
    enabled: queriesEnabled && reportType === 'payments',
  });
  const owingQuery = useQuery({
    queryKey: ['reports-owing', schoolId, date],
    queryFn: () => reportsApi.owing(schoolId!, date),
    enabled: queriesEnabled && reportType === 'owing',
  });
  const expensesQuery = useQuery({
    queryKey: ['reports-expenses', schoolId, date],
    queryFn: () => reportsApi.expenses(schoolId!, date),
    enabled: queriesEnabled && reportType === 'expenses',
  });

  const activeQuery = reportType === 'payments' ? paymentsQuery : reportType === 'owing' ? owingQuery : expensesQuery;
  const dateLabel = date ? `Specific Date: ${formatReportDate(date)}` : 'All Dates';

  const handleDownload = async () => {
    if (!schoolId || waitingForDate) return;
    setDownloading(true);
    try {
      await reportsApi.downloadPdf(schoolId, reportType, date);
      toast({ title: 'PDF downloaded' });
    } catch (error) {
      toast({ title: 'Could not generate PDF', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <SectionHeading eyebrow="Reports" title="Reports" detail="Payments, owing balances, and expenses — backed by GET /api/schools/[school_id]/reports/[type]." />
      {!schoolId ? <NoSchoolNotice /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Total received" value={formatCurrency(summaryQuery.data?.totalPayments ?? 0)} note={dateLabel} icon={ArrowDownLeft} />
            <MetricCard label="Total outstanding" value={formatCurrency(summaryQuery.data?.totalOutstanding ?? 0)} note={dateLabel} icon={CircleDollarSign} />
            <MetricCard label="Total expenses" value={formatCurrency(summaryQuery.data?.totalExpenses ?? 0)} note={dateLabel} icon={ArrowUpRight} />
            <MetricCard label="Net position" value={formatCurrency(summaryQuery.data?.netPosition ?? 0)} note="Payments − Expenses" icon={FileBarChart} />
          </div>
          <ErrorNotice error={summaryQuery.error} />

          <div className="mt-6 rounded-2xl border border-border/80 bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex rounded-lg border border-border p-1 text-xs font-semibold">
                {(Object.keys(REPORT_TYPE_LABELS) as ReportType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setReportType(type)}
                    className={`rounded-md px-3 py-1.5 ${reportType === type ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                  >
                    {REPORT_TYPE_LABELS[type]}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <input type="radio" name="report-date-mode" checked={dateMode === 'all'} onChange={() => setDateMode('all')} />
                  All Dates
                </label>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <input type="radio" name="report-date-mode" checked={dateMode === 'specific'} onChange={() => setDateMode('specific')} />
                  Specific Date
                </label>
                {dateMode === 'specific' && (
                  <input type="date" value={specificDate} onChange={(e) => setSpecificDate(e.target.value)} className="field h-9 text-xs" />
                )}
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={downloading || waitingForDate}
                  className="button-lift flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                >
                  <Download size={14} />{downloading ? 'Preparing…' : `Download ${REPORT_TYPE_LABELS[reportType]} PDF`}
                </button>
              </div>
            </div>

            <p className="mt-4 text-xs font-semibold text-foreground" data-testid="text-report-date-scope">
              Viewing: {dateLabel}
            </p>

            {waitingForDate ? (
              <p className="mt-4 rounded-lg border border-dashed border-border bg-secondary/30 px-3 py-3 text-xs text-muted-foreground">Select a date to view this report.</p>
            ) : (
              <>
                {reportType === 'payments' && (
                  <div className="mt-4 overflow-x-auto rounded-lg border border-border/60">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-secondary/60 text-[10px] uppercase text-muted-foreground">
                        <tr><th className="px-3 py-2 font-semibold">Date</th><th className="px-3 py-2 font-semibold">Customer</th><th className="px-3 py-2 font-semibold">Class</th><th className="px-3 py-2 font-semibold">Method</th><th className="px-3 py-2 font-semibold">Amount</th></tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {paymentsQuery.isLoading && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={5}>Loading…</td></tr>}
                        {!paymentsQuery.isLoading && (paymentsQuery.data?.rows.length ?? 0) === 0 && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={5}>No payments found for the selected period.</td></tr>}
                        {paymentsQuery.data?.rows.map((row) => (
                          <tr key={row.payment_id}>
                            <td className="px-3 py-2">{formatReportDate(row.paid_at_local)}</td>
                            <td className="px-3 py-2">{row.first_name} {row.last_name}</td>
                            <td className="px-3 py-2">{row.class_name}</td>
                            <td className="px-3 py-2">{row.method_name}</td>
                            <td className="px-3 py-2 font-semibold">{formatCurrency(row.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                      {(paymentsQuery.data?.rows.length ?? 0) > 0 && (
                        <tfoot>
                          <tr className="border-t border-border/80 bg-secondary/30 font-semibold">
                            <td className="px-3 py-2" colSpan={4}>Total Payments</td>
                            <td className="px-3 py-2">{formatCurrency(paymentsQuery.data!.total)}</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                )}

                {reportType === 'owing' && (
                  <div className="mt-4 overflow-x-auto rounded-lg border border-border/60">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-secondary/60 text-[10px] uppercase text-muted-foreground">
                        <tr><th className="px-3 py-2 font-semibold">Student</th><th className="px-3 py-2 font-semibold">Account</th><th className="px-3 py-2 font-semibold">Fee</th><th className="px-3 py-2 font-semibold">Expected</th><th className="px-3 py-2 font-semibold">Paid</th><th className="px-3 py-2 font-semibold">Outstanding</th><th className="px-3 py-2 font-semibold">Status</th></tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {owingQuery.isLoading && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={7}>Loading…</td></tr>}
                        {!owingQuery.isLoading && (owingQuery.data?.rows.length ?? 0) === 0 && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={7}>No outstanding balances found for the selected period.</td></tr>}
                        {owingQuery.data?.rows.map((row) => (
                          <tr key={row.charge_id}>
                            <td className="px-3 py-2">{row.first_name} {row.last_name}</td>
                            <td className="px-3 py-2 font-mono text-[11px]">{row.learner_id}</td>
                            <td className="px-3 py-2">{row.income_name}</td>
                            <td className="px-3 py-2">{formatCurrency(row.expected)}</td>
                            <td className="px-3 py-2">{formatCurrency(row.paid)}</td>
                            <td className="px-3 py-2 font-semibold text-destructive">{formatCurrency(row.balance)}</td>
                            <td className="px-3 py-2">{row.status}</td>
                          </tr>
                        ))}
                      </tbody>
                      {(owingQuery.data?.rows.length ?? 0) > 0 && (
                        <tfoot>
                          <tr className="border-t border-border/80 bg-secondary/30 font-semibold">
                            <td className="px-3 py-2" colSpan={5}>Total Outstanding</td>
                            <td className="px-3 py-2 text-destructive" colSpan={2}>{formatCurrency(owingQuery.data!.total)}</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                )}

                {reportType === 'expenses' && (
                  <div className="mt-4 overflow-x-auto rounded-lg border border-border/60">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-secondary/60 text-[10px] uppercase text-muted-foreground">
                        <tr><th className="px-3 py-2 font-semibold">Date</th><th className="px-3 py-2 font-semibold">Category</th><th className="px-3 py-2 font-semibold">Description</th><th className="px-3 py-2 font-semibold">Amount</th></tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {expensesQuery.isLoading && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={4}>Loading…</td></tr>}
                        {!expensesQuery.isLoading && (expensesQuery.data?.rows.length ?? 0) === 0 && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={4}>No expenses found for the selected period.</td></tr>}
                        {expensesQuery.data?.rows.map((row) => (
                          <tr key={row.expense_id}>
                            <td className="px-3 py-2">{formatReportDate(row.expense_date)}</td>
                            <td className="px-3 py-2">{row.category_name}</td>
                            <td className="px-3 py-2">{row.description}</td>
                            <td className="px-3 py-2 font-semibold">{formatCurrency(row.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                      {(expensesQuery.data?.rows.length ?? 0) > 0 && (
                        <tfoot>
                          <tr className="border-t border-border/80 bg-secondary/30 font-semibold">
                            <td className="px-3 py-2" colSpan={3}>Total Expenses</td>
                            <td className="px-3 py-2">{formatCurrency(expensesQuery.data!.total)}</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                )}
                <ErrorNotice error={activeQuery.error} />
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
