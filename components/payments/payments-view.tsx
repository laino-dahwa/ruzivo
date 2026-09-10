'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useToast } from '../../app/components/hooks/use-toast';
import { useCurrentSchoolId } from '../../lib/client/current-school-id';
import { formatCurrency } from '../../lib/currency';
import { balancesApi, paymentsApi } from '../../services/payments';
import type { CreateChargesWithPaymentsInput, Payment } from '../../types/payment';
import { useSchoolReferenceData } from '../reference-data/use-school-reference-data';
import { LearnerAutocomplete } from '../learners/learner-autocomplete';
import { SectionHeading } from '../shared/section-heading';
import { NoSchoolNotice } from '../shared/no-school-notice';
import { ErrorNotice } from '../shared/error-notice';
import { ConfirmDialog } from '../shared/confirm-dialog';
import { DownloadPdfButton } from '../shared/download-pdf-button';
import { AddRecordButton, FormDialog } from '../shared/form-dialog';

// One fee being paid: an income category and the amount paid towards it.
// A learner block can hold several, which is what lets one learner pay for
// several fees in a single submission.
type PaymentLine = { income_category_id: string; amount: string };

// One learner's payment. Mirrors CreateChargesWithPaymentsInput exactly: the
// learner/period/method apply to the whole block, and each line becomes its
// own charge + payment + allocation.
type PaymentBlock = {
  learner_id: string;
  enrolment_id: string;
  payment_period_id: string;
  payment_method_id: string;
  lines: PaymentLine[];
};

function emptyPaymentLine(): PaymentLine {
  return { income_category_id: '', amount: '' };
}

function emptyPaymentBlock(): PaymentBlock {
  return { learner_id: '', enrolment_id: '', payment_period_id: '', payment_method_id: '', lines: [emptyPaymentLine()] };
}

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
  const [blocks, setBlocks] = useState<PaymentBlock[]>([emptyPaymentBlock()]);
  const [pendingDeletePayment, setPendingDeletePayment] = useState<Payment | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  // Every line across every learner is one payment record.
  const totalPayments = blocks.reduce((count, block) => count + block.lines.length, 0);

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

  // What each learner has already paid, per fee and period. Reuses the same
  // endpoint the Owing page uses, and is invalidated on every payment, so the
  // remaining amounts shown here stay in step with the server.
  const balancesQuery = useQuery({
    queryKey: ['balances'],
    queryFn: () => balancesApi.list(),
    enabled: !!schoolId,
  });

  /**
   * Limit / paid / remaining for one payment line, or null when the fee has
   * no configured limit or the line isn't complete enough to price yet.
   * Mirrors the server's rule exactly, including counting earlier lines in
   * this same form so a bulk entry can't silently plan an overpayment.
   */
  const feeStatusFor = (block: PaymentBlock, blockIndex: number, lineIndex: number) => {
    const line = block.lines[lineIndex];
    if (!block.learner_id || !block.payment_period_id || !line.income_category_id) return null;

    const income = ref.incomeCategories.data?.find((i) => String(i.income_category_id) === line.income_category_id);
    const period = ref.paymentPeriods.data?.find((p) => String(p.payment_period_id) === block.payment_period_id);
    if (!income || income.income_limit === null || income.income_limit === undefined || !period) return null;

    const limit = Number(income.income_limit);
    if (!Number.isFinite(limit)) return null;

    const balanceRow = balancesQuery.data?.find((b) =>
      b.learner_id === block.learner_id && b.income_name === income.income_name && b.period_name === period.period_name);
    const paid = Number(balanceRow?.paid ?? 0);

    // Amounts already entered on earlier lines of this form for the very same
    // learner + fee + period.
    let pending = 0;
    blocks.forEach((otherBlock, otherBlockIndex) => {
      otherBlock.lines.forEach((otherLine, otherLineIndex) => {
        const isEarlier = otherBlockIndex < blockIndex || (otherBlockIndex === blockIndex && otherLineIndex < lineIndex);
        if (!isEarlier) return;
        if (otherBlock.learner_id !== block.learner_id) return;
        if (otherBlock.payment_period_id !== block.payment_period_id) return;
        if (otherLine.income_category_id !== line.income_category_id) return;
        pending += Number(otherLine.amount) || 0;
      });
    });

    return {
      limit,
      paid,
      remaining: Math.max(limit - paid - pending, 0),
      periodName: period.period_name,
    };
  };

  const recordPayment = useMutation({
    mutationFn: (inputs: CreateChargesWithPaymentsInput[]) => paymentsApi.create(inputs),
    onSuccess: (_result, inputs) => {
      const recorded = inputs.reduce((count, input) => count + input.income_categories.length, 0);
      toast({ title: recorded === 1 ? 'Payment recorded' : `${recorded} payments recorded` });
      setAddOpen(false);
      // Reset only on success — a failed submission keeps every row so the
      // user can fix the problem instead of retyping the batch.
      setBlocks([emptyPaymentBlock()]);
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

  const updateBlock = (index: number, patch: Partial<PaymentBlock>) =>
    setBlocks((current) => current.map((block, i) => (i === index ? { ...block, ...patch } : block)));

  const updateLine = (blockIndex: number, lineIndex: number, patch: Partial<PaymentLine>) =>
    setBlocks((current) => current.map((block, i) => (
      i === blockIndex
        ? { ...block, lines: block.lines.map((line, l) => (l === lineIndex ? { ...line, ...patch } : line)) }
        : block
    )));

  const addBlock = () => setBlocks((current) => [...current, emptyPaymentBlock()]);

  const removeBlock = (index: number) => setBlocks((current) => current.filter((_, i) => i !== index));

  const addLine = (blockIndex: number) =>
    setBlocks((current) => current.map((block, i) => (
      i === blockIndex ? { ...block, lines: [...block.lines, emptyPaymentLine()] } : block
    )));

  const removeLine = (blockIndex: number, lineIndex: number) =>
    setBlocks((current) => current.map((block, i) => (
      i === blockIndex ? { ...block, lines: block.lines.filter((_, l) => l !== lineIndex) } : block
    )));

  const submitPayment = (event: FormEvent) => {
    event.preventDefault();
    if (!schoolId) return;

    const missingLearner = blocks.findIndex((block) => !block.learner_id);
    if (missingLearner !== -1) {
      toast({
        title: blocks.length === 1 ? 'Select a learner first' : `Learner ${missingLearner + 1}: select a learner first`,
        variant: 'destructive',
      });
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

    // One request, one transaction: every line of every learner lands, or
    // none does.
    recordPayment.mutate(blocks.map((block) => ({
      learner_id: block.learner_id,
      enrolment_id: Number(block.enrolment_id),
      payment_period_id: Number(block.payment_period_id),
      academic_year_id: academicYearId,
      payment_method_id: Number(block.payment_method_id),
      income_categories: block.lines.map((line) => ({
        income_category_id: Number(line.income_category_id),
        amount: Number(line.amount),
      })),
    })));
  };

  const submitLabel = recordPayment.isPending
    ? 'Saving…'
    : totalPayments === 1 ? 'Record payment' : `Record ${totalPayments} payments`;

  return (
    <>
      <SectionHeading
        eyebrow="Payments"
        title="Payments"
        detail="Payments are created as charges + allocations via POST /api/learners/payments."
        action={schoolId ? <AddRecordButton label="Record payment" onClick={() => setAddOpen(true)} testId="button-open-record-payment" /> : undefined}
      />
      {!schoolId ? <NoSchoolNotice /> : (
        <>
          <FormDialog
            open={addOpen}
            width="xl"
            title={totalPayments === 1 ? 'Record a payment' : `Record ${totalPayments} payments`}
            description="Uses the first available academic year record. Enrolment ID fills in automatically once a learner is selected."
            onClose={() => setAddOpen(false)}
          >
            <form onSubmit={submitPayment} className="space-y-4">
              {blocks.map((block, blockIndex) => (
                <div key={blockIndex} className="space-y-2 rounded-xl border border-border/60 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Learner {blockIndex + 1}
                      {block.lines.length > 1 && ` · ${block.lines.length} payments`}
                    </span>
                    {blocks.length > 1 && (
                      <button
                        type="button"
                        title="Remove this learner"
                        onClick={() => removeBlock(blockIndex)}
                        className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <LearnerAutocomplete placeholder="Search learner by name…" onSelect={(learner) => updateBlock(blockIndex, { learner_id: learner?.learner_id ?? '', enrolment_id: learner ? String(learner.enrolment_id) : '' })} />
                      {block.learner_id && <p className="mt-1 font-mono text-[10px] text-muted-foreground">Learner ID: {block.learner_id}</p>}
                    </div>
                    <input required type="number" placeholder="Enrolment ID" readOnly value={block.enrolment_id} className="field bg-secondary/40" />
                    <select required value={block.payment_period_id} onChange={(e) => updateBlock(blockIndex, { payment_period_id: e.target.value })} className="field">
                      <option value="">Payment period…</option>
                      {ref.paymentPeriods.data?.map((p) => <option key={p.payment_period_id} value={p.payment_period_id}>{p.period_name}</option>)}
                    </select>
                    <select required value={block.payment_method_id} onChange={(e) => updateBlock(blockIndex, { payment_method_id: e.target.value })} className="field">
                      <option value="">Payment method…</option>
                      {ref.paymentMethods.data?.map((p) => <option key={p.payment_method_id} value={p.payment_method_id}>{p.method_name}</option>)}
                    </select>
                  </div>

                  {/* Each line is a separate fee for this same learner. */}
                  {block.lines.map((line, lineIndex) => (
                    <div key={lineIndex} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <select required value={line.income_category_id} onChange={(e) => updateLine(blockIndex, lineIndex, { income_category_id: e.target.value })} className="field lg:col-span-2">
                        <option value="">Income category…</option>
                        {ref.incomeCategories.data?.map((i) => <option key={i.income_category_id} value={i.income_category_id}>{i.income_name}</option>)}
                      </select>
                      <div>
                        {(() => {
                          const status = feeStatusFor(block, blockIndex, lineIndex);
                          return (
                            <>
                              <input
                                required
                                type="number"
                                min="1"
                                max={status ? status.remaining : undefined}
                                placeholder="Amount"
                                value={line.amount}
                                onChange={(e) => updateLine(blockIndex, lineIndex, { amount: e.target.value })}
                                className="field"
                              />
                              {status && (
                                <p className={`mt-1 text-[10px] ${status.remaining === 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                                  {status.remaining === 0
                                    ? `Fully paid for ${status.periodName} — limit ${formatCurrency(status.limit)}`
                                    : `Limit ${formatCurrency(status.limit)} · Paid ${formatCurrency(status.paid)} · Max ${formatCurrency(status.remaining)}`}
                                </p>
                              )}
                            </>
                          );
                        })()}
                      </div>
                      <div className="flex items-center">
                        {block.lines.length > 1 && (
                          <button
                            type="button"
                            title="Remove this payment"
                            onClick={() => removeLine(blockIndex, lineIndex)}
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={() => addLine(blockIndex)}
                    data-testid={`button-add-payment-line-${blockIndex}`}
                    className="button-lift flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-background px-2.5 text-[11px] font-semibold text-foreground hover:border-primary/50"
                  >
                    <Plus size={13} />Another payment for this learner
                  </button>
                </div>
              ))}

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <button type="button" onClick={addBlock} className="button-lift flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-background text-xs font-semibold text-foreground hover:border-primary/50" data-testid="button-add-payment-row"><Plus size={15} />Add another learner</button>
                <button type="submit" disabled={recordPayment.isPending} className="button-lift flex h-10 items-center justify-center gap-2 rounded-lg bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-60 lg:col-span-2"><Plus size={15} />{submitLabel}</button>
              </div>
            </form>
            <ErrorNotice error={recordPayment.error} />
          </FormDialog>

          <div className="rounded-2xl border border-border/80 bg-card p-5">
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
              <div className="flex items-end">
                <DownloadPdfButton
                  disabled={paymentsQuery.isLoading}
                  onDownload={() => paymentsApi.downloadPdf({
                    learner_id: filters.learner_id || null,
                    class_name: filters.class_name || null,
                    gender_name: filters.gender_name || null,
                    academic_year: filters.academic_year || null,
                    income_name: filters.income_name || null,
                    payment_period: filters.payment_period || null,
                    method_name: filters.method_name || null,
                  })}
                />
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
