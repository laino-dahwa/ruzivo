'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, CircleDollarSign, ClipboardX } from 'lucide-react';
import { useCurrentSchoolId } from '../../lib/client/current-school-id';
import { formatCurrency } from '../../lib/currency';
import { obligationsApi } from '../../services/obligations';
import type { ObligationFilters } from '../../types/payment';
import { useSchoolReferenceData } from '../reference-data/use-school-reference-data';
import { LearnerAutocomplete } from '../learners/learner-autocomplete';
import { SectionHeading } from '../shared/section-heading';
import { NoSchoolNotice } from '../shared/no-school-notice';
import { ErrorNotice } from '../shared/error-notice';
import { DownloadPdfButton } from '../shared/download-pdf-button';
import { MetricCard } from '../shared/metric-card';

const STATUS_LABEL: Record<string, string> = {
  NO_PAYMENT: 'No Payment',
  PARTIALLY_PAID: 'Partially Paid',
  FULLY_PAID: 'Fully Paid',
};

/**
 * Learners with a fee obligation — defaults to Mandatory fees nobody has
 * paid anything toward yet, the gap the Owings module used to miss entirely
 * (a learner with zero charges was invisible everywhere). Every filter stays
 * adjustable and they combine with AND, per the brief.
 *
 * `status` is applied client-side against an otherwise-filtered fetch, so
 * the summary cards above the table always reflect every status in the
 * current class/learner/category/priority/year/period selection, not just
 * whichever one the table is currently narrowed to.
 */
export function UnpaidMandatoryView() {
  const { schoolId } = useCurrentSchoolId();
  const ref = useSchoolReferenceData(schoolId);
  const [filters, setFilters] = useState({
    class_category_id: '',
    learner_id: '',
    income_category_id: '',
    priority: 'MANDATORY',
    status: 'NO_PAYMENT',
    academic_year_id: '',
    payment_period_id: '',
  });

  const serverFilters: ObligationFilters = {
    class_category_id: filters.class_category_id ? Number(filters.class_category_id) : null,
    learner_id: filters.learner_id || null,
    income_category_id: filters.income_category_id ? Number(filters.income_category_id) : null,
    priority: (filters.priority || null) as ObligationFilters['priority'],
    academic_year_id: filters.academic_year_id ? Number(filters.academic_year_id) : null,
    payment_period_id: filters.payment_period_id ? Number(filters.payment_period_id) : null,
  };

  const obligationsQuery = useQuery({
    queryKey: ['obligations', schoolId, serverFilters],
    queryFn: () => obligationsApi.list(schoolId!, serverFilters),
    enabled: !!schoolId,
  });

  const rows = useMemo(() => obligationsQuery.data ?? [], [obligationsQuery.data]);
  const visibleRows = filters.status ? rows.filter((row) => row.status === filters.status) : rows;

  const summary = useMemo(() => {
    const noPayment = rows.filter((r) => r.status === 'NO_PAYMENT').length;
    const partiallyPaid = rows.filter((r) => r.status === 'PARTIALLY_PAID').length;
    const fullyPaid = rows.filter((r) => r.status === 'FULLY_PAID').length;
    const totalOutstanding = rows
      .filter((r) => r.status === 'NO_PAYMENT' || r.status === 'PARTIALLY_PAID')
      .reduce((sum, r) => sum + Number(r.balance ?? 0), 0);
    return { noPayment, partiallyPaid, fullyPaid, totalOutstanding };
  }, [rows]);

  return (
    <>
      <SectionHeading
        eyebrow="Owing"
        title="Unpaid Mandatory Payments"
        detail="Learners expected to pay a mandatory fee, including those who have never made a payment toward it."
      />
      {!schoolId ? <NoSchoolNotice /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="No Payment" value={String(summary.noPayment)} note="Nothing paid yet" icon={ClipboardX} />
            <MetricCard label="Partially Paid" value={String(summary.partiallyPaid)} note="Some, but not all, paid" icon={AlertCircle} />
            <MetricCard label="Fully Paid" value={String(summary.fullyPaid)} note="Settled" icon={CheckCircle2} />
            <MetricCard label="Total Outstanding" value={formatCurrency(summary.totalOutstanding)} note="No Payment + Partially Paid" icon={CircleDollarSign} />
          </div>

          <div className="mt-6 rounded-2xl border border-border/80 bg-card p-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div><label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Learner</label><LearnerAutocomplete placeholder="Search by name…" onSelect={(learner) => setFilters((f) => ({ ...f, learner_id: learner?.learner_id ?? '' }))} /></div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Class</label>
                <select value={filters.class_category_id} onChange={(e) => setFilters((f) => ({ ...f, class_category_id: e.target.value }))} className="field h-9 text-xs">
                  <option value="">All</option>
                  {ref.classCategories.data?.map((c) => <option key={c.class_category_id} value={c.class_category_id}>{c.class_name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Income category</label>
                <select value={filters.income_category_id} onChange={(e) => setFilters((f) => ({ ...f, income_category_id: e.target.value }))} className="field h-9 text-xs">
                  <option value="">All</option>
                  {ref.incomeCategories.data?.map((i) => <option key={i.income_category_id} value={i.income_category_id}>{i.income_name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Priority</label>
                <select value={filters.priority} onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))} className="field h-9 text-xs">
                  <option value="">All</option>
                  <option value="MANDATORY">Mandatory</option>
                  <option value="OPTIONAL">Optional</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Payment status</label>
                <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className="field h-9 text-xs">
                  <option value="">All</option>
                  <option value="NO_PAYMENT">No Payment</option>
                  <option value="PARTIALLY_PAID">Partially Paid</option>
                  <option value="FULLY_PAID">Fully Paid</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Academic year</label>
                <select value={filters.academic_year_id} onChange={(e) => setFilters((f) => ({ ...f, academic_year_id: e.target.value }))} className="field h-9 text-xs">
                  <option value="">All</option>
                  {ref.academicYears.data?.map((y) => <option key={y.academic_year_id} value={y.academic_year_id}>{y.academic_year_name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Payment period</label>
                <select value={filters.payment_period_id} onChange={(e) => setFilters((f) => ({ ...f, payment_period_id: e.target.value }))} className="field h-9 text-xs">
                  <option value="">All</option>
                  {ref.paymentPeriods.data?.map((p) => <option key={p.payment_period_id} value={p.payment_period_id}>{p.period_name}</option>)}
                </select>
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <DownloadPdfButton
                disabled={obligationsQuery.isLoading}
                onDownload={() => obligationsApi.downloadPdf(schoolId!, { ...serverFilters, status: (filters.status || null) as ObligationFilters['status'] })}
              />
            </div>

            <div className="mt-4 overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full text-left text-xs">
                <thead className="bg-secondary/60 text-[10px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Learner</th>
                    <th className="px-3 py-2 font-semibold">Class</th>
                    <th className="px-3 py-2 font-semibold">Category</th>
                    <th className="px-3 py-2 font-semibold">Priority</th>
                    <th className="px-3 py-2 font-semibold">Period</th>
                    <th className="px-3 py-2 font-semibold">Expected</th>
                    <th className="px-3 py-2 font-semibold">Paid</th>
                    <th className="px-3 py-2 font-semibold">Outstanding</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {obligationsQuery.isLoading && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={9}>Loading…</td></tr>}
                  {!obligationsQuery.isLoading && visibleRows.length === 0 && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={9}>No matching obligations</td></tr>}
                  {visibleRows.map((row, index) => (
                    <tr key={index}>
                      <td className="px-3 py-2">{row.first_name} {row.last_name}</td>
                      <td className="px-3 py-2">{row.class_name}</td>
                      <td className="px-3 py-2">{row.income_name}</td>
                      <td className="px-3 py-2">{row.priority === 'MANDATORY' ? 'Mandatory' : 'Optional'}</td>
                      <td className="px-3 py-2">{row.period_name}</td>
                      <td className="px-3 py-2">{row.expected === null ? '—' : formatCurrency(row.expected)}</td>
                      <td className="px-3 py-2">{formatCurrency(row.paid)}</td>
                      <td className={`px-3 py-2 font-semibold ${Number(row.balance) > 0 ? 'text-destructive' : 'text-primary'}`}>{row.balance === null ? '—' : formatCurrency(row.balance)}</td>
                      <td className="px-3 py-2">{row.status ? STATUS_LABEL[row.status] : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ErrorNotice error={obligationsQuery.error} />
            </div>
          </div>
        </>
      )}
    </>
  );
}
