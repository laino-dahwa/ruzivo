'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowDownLeft, ArrowUpRight, CircleDollarSign, Users } from 'lucide-react';
import { useCurrentSchoolId } from '../../lib/client/current-school-id';
import { learnersApi } from '../../services/learners';
import { balancesApi, paymentsApi } from '../../services/payments';
import { expensesApi } from '../../services/expenses';
import { formatCurrency } from '../../lib/currency';
import { SectionHeading } from '../shared/section-heading';
import { MetricCard } from '../shared/metric-card';
import { NoSchoolNotice } from '../shared/no-school-notice';

export function OverviewView() {
  const { schoolId } = useCurrentSchoolId();
  const learnersQuery = useQuery({ queryKey: ['learners'], queryFn: () => learnersApi.list(), enabled: !!schoolId });
  const balancesQuery = useQuery({ queryKey: ['balances'], queryFn: () => balancesApi.list(), enabled: !!schoolId });
  const paymentsQuery = useQuery({ queryKey: ['payments'], queryFn: () => paymentsApi.list(), enabled: !!schoolId });
  const expensesQuery = useQuery({ queryKey: ['expenses', schoolId], queryFn: () => expensesApi.list(schoolId!), enabled: !!schoolId });

  const totalPaid = useMemo(() => (paymentsQuery.data ?? []).reduce((sum, item) => sum + Number(item.amount || 0), 0), [paymentsQuery.data]);
  const totalOutstanding = useMemo(() => (balancesQuery.data ?? []).reduce((sum, item) => sum + Number(item.balance || 0), 0), [balancesQuery.data]);
  const totalExpenses = useMemo(() => (expensesQuery.data ?? []).reduce((sum, item) => sum + Number(item.amount || 0), 0), [expensesQuery.data]);

  return (
    <>
      <SectionHeading eyebrow="Live overview" title="School finance overview" detail="Data below is fetched live from your Next.js API routes and Postgres database." />
      {!schoolId ? <NoSchoolNotice /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Learners" value={String(learnersQuery.data?.length ?? 0)} note="Total learner records" icon={Users} />
            <MetricCard label="Payments received" value={formatCurrency(totalPaid)} note={`${paymentsQuery.data?.length ?? 0} payment records`} icon={ArrowDownLeft} />
            <MetricCard label="Outstanding balance" value={formatCurrency(totalOutstanding)} note="Across all charges" icon={CircleDollarSign} />
            <MetricCard label="Expenses logged" value={formatCurrency(totalExpenses)} note={`${expensesQuery.data?.length ?? 0} records`} icon={ArrowUpRight} />
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <Link href="/learners" className="button-lift rounded-xl border border-border/80 bg-card p-4 text-sm font-semibold hover:border-primary/50">Manage learners →</Link>
            <Link href="/payments" className="button-lift rounded-xl border border-border/80 bg-card p-4 text-sm font-semibold hover:border-primary/50">Record a payment →</Link>
            <Link href="/expenses" className="button-lift rounded-xl border border-border/80 bg-card p-4 text-sm font-semibold hover:border-primary/50">Log an expense →</Link>
          </div>
        </>
      )}
    </>
  );
}
