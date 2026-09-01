'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useToast } from '../../app/components/hooks/use-toast';
import { useCurrentSchoolId } from '../../lib/client/current-school-id';
import { formatCurrency } from '../../lib/currency';
import { paymentsApi } from '../../services/payments';
import type { CreateChargesWithPaymentsInput, Payment } from '../../types/payment';
import { useSchoolReferenceData } from '../reference-data/use-school-reference-data';
import { LearnerAutocomplete } from '../learners/learner-autocomplete';
import { SectionHeading } from '../shared/section-heading';
import { NoSchoolNotice } from '../shared/no-school-notice';
import { ErrorNotice } from '../shared/error-notice';
import { ConfirmDialog } from '../shared/confirm-dialog';

export function PaymentsView() {
  const { schoolId } = useCurrentSchoolId();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const ref = useSchoolReferenceData(schoolId);
  const [filters, setFilters] = useState({
    learner_id: '',
    class_name: '',
    gender_name: '',
    academic_year: '',
    income_name: '',
    payment_period: '',
    method_name: '',
  });
  const [form, setForm] = useState({ learner_id: '', enrolment_id: '', payment_period_id: '', payment_method_id: '', income_category_id: '', amount: '' });
  const [pendingDeletePayment, setPendingDeletePayment] = useState<Payment | null>(null);

  const paymentsQuery = useQuery({
    queryKey: ['payments', filters],
    queryFn: () => paymentsApi.list({
      learner_id: filters.learner_id || null,
      class_name: filters.class_name || null,
      gender_name: filters.gender_name || null,
      academic_year: filters.academic_year || null,
      income_name: filters.income_name || null,
      payment_period: filters.payment_period || null,
      method_name: filters.method_name || null,
    }),
  });

  const recordPayment = useMutation({
    mutationFn: (input: CreateChargesWithPaymentsInput) => paymentsApi.create(input),
    onSuccess: () => {
      toast({ title: 'Payment recorded' });
      setForm({ learner_id: '', enrolment_id: '', payment_period_id: '', payment_method_id: '', income_category_id: '', amount: '' });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['balances'] });
    },
    onError: (error) => toast({ title: 'Payment failed', description: (error as Error).message, variant: 'destructive' }),
  });

  const deleteCharge = useMutation({
    mutationFn: (id: number) => paymentsApi.deleteCharge(id),
    onSuccess: () => {
      toast({ title: 'Charge deleted' });
      setPendingDeletePayment(null);
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['balances'] });
    },
    onError: (error) => toast({ title: 'Delete failed', description: (error as Error).message, variant: 'destructive' }),
  });

  const submitPayment = (event: FormEvent) => {
    event.preventDefault();
    if (!schoolId) return;
    if (!form.learner_id) {
      toast({ title: 'Select a learner first', variant: 'destructive' });
      return;
    }
    // Preserves the existing, pre-migration behavior: the first available
    // academic year record is used automatically rather than letting the
    // user choose one (there is no academic-year picker in this form).
    const academicYearId = ref.academicYears.data?.[0]?.academic_year_id;
    if (!academicYearId) {
      toast({ title: 'Add an academic year first', variant: 'destructive' });
      return;
    }
    recordPayment.mutate({
      learner_id: form.learner_id,
      enrolment_id: Number(form.enrolment_id),
      payment_period_id: Number(form.payment_period_id),
      academic_year_id: academicYearId,
      payment_method_id: Number(form.payment_method_id),
      income_categories: [{ income_category_id: Number(form.income_category_id), amount: Number(form.amount) }],
    });
  };

  return (
    <>
      <SectionHeading eyebrow="Payments" title="Payments" detail="Payments are created as charges + allocations via POST /api/learners/payments." />
      {!schoolId ? <NoSchoolNotice /> : (
        <>
          <div className="rounded-2xl border border-border/80 bg-card p-5">
            <h3 className="text-sm font-semibold">Record a payment</h3>
            <form onSubmit={submitPayment} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <LearnerAutocomplete placeholder="Search learner by name…" onSelect={(learner) => setForm((f) => ({ ...f, learner_id: learner?.learner_id ?? '', enrolment_id: learner ? String(learner.enrolment_id) : '' }))} />
                {form.learner_id && <p className="mt-1 font-mono text-[10px] text-muted-foreground">Learner ID: {form.learner_id}</p>}
              </div>
              <input required type="number" placeholder="Enrolment ID" readOnly value={form.enrolment_id} className="field bg-secondary/40" />
              <select required value={form.payment_period_id} onChange={(e) => setForm((f) => ({ ...f, payment_period_id: e.target.value }))} className="field">
                <option value="">Payment period…</option>
                {ref.paymentPeriods.data?.map((p) => <option key={p.payment_period_id} value={p.payment_period_id}>{p.period_name}</option>)}
              </select>
              <select required value={form.payment_method_id} onChange={(e) => setForm((f) => ({ ...f, payment_method_id: e.target.value }))} className="field">
                <option value="">Payment method…</option>
                {ref.paymentMethods.data?.map((p) => <option key={p.payment_method_id} value={p.payment_method_id}>{p.method_name}</option>)}
              </select>
              <select required value={form.income_category_id} onChange={(e) => setForm((f) => ({ ...f, income_category_id: e.target.value }))} className="field">
                <option value="">Income category…</option>
                {ref.incomeCategories.data?.map((i) => <option key={i.income_category_id} value={i.income_category_id}>{i.income_name}</option>)}
              </select>
              <input required type="number" min="1" placeholder="Amount" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className="field" />
              <button type="submit" disabled={recordPayment.isPending} className="button-lift flex h-10 items-center justify-center gap-2 rounded-lg bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-60 sm:col-span-2 lg:col-span-3"><Plus size={15} />{recordPayment.isPending ? 'Saving…' : 'Record payment'}</button>
            </form>
            <p className="mt-2 text-[11px] text-muted-foreground">Uses the first available academic year record. Enrolment ID fills in automatically once a learner is selected.</p>
            <ErrorNotice error={recordPayment.error} />
          </div>

          <div className="mt-6 rounded-2xl border border-border/80 bg-card p-5">
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Payment method</label>
                <select value={filters.method_name} onChange={(e) => setFilters((f) => ({ ...f, method_name: e.target.value }))} className="field h-9 text-xs">
                  <option value="">All</option>
                  {ref.paymentMethods.data?.map((m) => <option key={m.payment_method_id} value={m.method_name}>{m.method_name}</option>)}
                </select>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full text-left text-xs">
                <thead className="bg-secondary/60 text-[10px] uppercase text-muted-foreground">
                  <tr><th className="px-3 py-2 font-semibold">Learner</th><th className="px-3 py-2 font-semibold">Income</th><th className="px-3 py-2 font-semibold">Period</th><th className="px-3 py-2 font-semibold">Method</th><th className="px-3 py-2 font-semibold">Amount</th><th className="px-3 py-2 font-semibold"></th></tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {paymentsQuery.isLoading && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={6}>Loading…</td></tr>}
                  {!paymentsQuery.isLoading && (paymentsQuery.data?.length ?? 0) === 0 && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={6}>No payments found</td></tr>}
                  {paymentsQuery.data?.map((payment, index) => (
                    <tr key={index}>
                      <td className="px-3 py-2">{payment.first_name} {payment.last_name}</td>
                      <td className="px-3 py-2">{payment.income_name}</td>
                      <td className="px-3 py-2">{payment.period_name}</td>
                      <td className="px-3 py-2">{payment.method_name}</td>
                      <td className="px-3 py-2 font-semibold">{formatCurrency(payment.amount)}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          title="Delete this payment"
                          disabled={deleteCharge.isPending}
                          onClick={() => setPendingDeletePayment(payment)}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ErrorNotice error={paymentsQuery.error} />
            </div>
            <ErrorNotice error={deleteCharge.error} />
          </div>
        </>
      )}
      <ConfirmDialog
        open={!!pendingDeletePayment}
        title="Delete this payment?"
        description={pendingDeletePayment ? `The ${pendingDeletePayment.income_name} payment of ${formatCurrency(pendingDeletePayment.amount)} for ${pendingDeletePayment.first_name} ${pendingDeletePayment.last_name} will be removed.` : undefined}
        pending={deleteCharge.isPending}
        onCancel={() => setPendingDeletePayment(null)}
        onConfirm={() => { if (pendingDeletePayment) deleteCharge.mutate(pendingDeletePayment.charge_id); }}
      />
    </>
  );
}
