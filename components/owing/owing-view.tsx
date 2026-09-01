'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCurrentSchoolId } from '../../lib/client/current-school-id';
import { formatCurrency } from '../../lib/currency';
import { balancesApi } from '../../services/payments';
import { useSchoolReferenceData } from '../reference-data/use-school-reference-data';
import { LearnerAutocomplete } from '../learners/learner-autocomplete';
import { SectionHeading } from '../shared/section-heading';
import { NoSchoolNotice } from '../shared/no-school-notice';
import { ErrorNotice } from '../shared/error-notice';

export function OwingView() {
  const { schoolId } = useCurrentSchoolId();
  const ref = useSchoolReferenceData(schoolId);
  const [filters, setFilters] = useState({
    learner_id: '',
    class_name: '',
    gender_name: '',
    academic_year: '',
    income_name: '',
    payment_period: '',
  });

  const balancesQuery = useQuery({
    queryKey: ['balances', filters],
    queryFn: () => balancesApi.list({
      learner_id: filters.learner_id || null,
      class_name: filters.class_name || null,
      gender_name: filters.gender_name || null,
      academic_year: filters.academic_year || null,
      income_name: filters.income_name || null,
      payment_period: filters.payment_period || null,
    }),
  });

  return (
    <>
      <SectionHeading eyebrow="Owing" title="Outstanding balances" detail="Fetched live from GET /api/learners/balances." />
      {!schoolId ? <NoSchoolNotice /> : (
        <div className="rounded-2xl border border-border/80 bg-card p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div><label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Learner name</label><LearnerAutocomplete placeholder="Search by name…" onSelect={(learner) => setFilters((f) => ({ ...f, learner_id: learner?.learner_id ?? '' }))} /></div>
            <div><label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Class</label><input value={filters.class_name} onChange={(e) => setFilters((f) => ({ ...f, class_name: e.target.value }))} placeholder="e.g. Grade 4" className="field h-9 text-xs" /></div>
            <div><label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Gender</label><input value={filters.gender_name} onChange={(e) => setFilters((f) => ({ ...f, gender_name: e.target.value }))} placeholder="e.g. Female" className="field h-9 text-xs" /></div>
            <div><label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Academic year</label><input value={filters.academic_year} onChange={(e) => setFilters((f) => ({ ...f, academic_year: e.target.value }))} placeholder="e.g. 2026" className="field h-9 text-xs" /></div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Income category</label>
              <select value={filters.income_name} onChange={(e) => setFilters((f) => ({ ...f, income_name: e.target.value }))} className="field h-9 text-xs">
                <option value="">All</option>
                {ref.incomeCategories.data?.map((i) => <option key={i.income_category_id} value={i.income_name}>{i.income_name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Payment period</label>
              <select value={filters.payment_period} onChange={(e) => setFilters((f) => ({ ...f, payment_period: e.target.value }))} className="field h-9 text-xs">
                <option value="">All</option>
                {ref.paymentPeriods.data?.map((p) => <option key={p.payment_period_id} value={p.period_name}>{p.period_name}</option>)}
              </select>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-left text-xs">
              <thead className="bg-secondary/60 text-[10px] uppercase text-muted-foreground">
                <tr><th className="px-3 py-2 font-semibold">Learner</th><th className="px-3 py-2 font-semibold">Income</th><th className="px-3 py-2 font-semibold">Charged</th><th className="px-3 py-2 font-semibold">Paid</th><th className="px-3 py-2 font-semibold">Balance</th></tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {balancesQuery.isLoading && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={5}>Loading…</td></tr>}
                {!balancesQuery.isLoading && (balancesQuery.data?.length ?? 0) === 0 && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={5}>No balances found</td></tr>}
                {balancesQuery.data?.map((balance, index) => (
                  <tr key={index}>
                    <td className="px-3 py-2">{balance.first_name} {balance.last_name}</td>
                    <td className="px-3 py-2">{balance.income_name}</td>
                    <td className="px-3 py-2">{formatCurrency(balance.charged)}</td>
                    <td className="px-3 py-2">{formatCurrency(balance.paid)}</td>
                    <td className={`px-3 py-2 font-semibold ${Number(balance.balance) > 0 ? 'text-destructive' : 'text-primary'}`}>{formatCurrency(balance.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ErrorNotice error={balancesQuery.error} />
          </div>
        </div>
      )}
    </>
  );
}
