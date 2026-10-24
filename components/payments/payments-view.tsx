'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Printer, Trash2 } from 'lucide-react';
import { useToast } from '../../app/components/hooks/use-toast';
import { useCurrentSchoolId } from '../../lib/client/current-school-id';
import { useSchoolName } from '../../lib/client/use-school-name';
import { useSchoolLogo } from '../../lib/client/use-school-logo';
import { currentAcademicYear } from '../../lib/client/current-academic-year';
import { formatCurrency } from '../../lib/currency';
import { buildReceiptHtml } from '../../lib/receipt/buildReceiptHtml';
import { balancesApi, paymentsApi } from '../../services/payments';
import { learnersApi } from '../../services/learners';
import { schoolLogoUrl } from '../../services/logo';
import { printHtml } from '../../services/print';
import { PagedListFooter, usePagedList } from '../shared/paged-list';
import type { CreateChargesWithPaymentsInput, CreatedChargeWithPayment, Payment } from '../../types/payment';
import { useSchoolReferenceData } from '../reference-data/use-school-reference-data';
import { LearnerAutocomplete } from '../learners/learner-autocomplete';
import { SectionHeading } from '../shared/section-heading';
import { NoSchoolNotice } from '../shared/no-school-notice';
import { ErrorNotice } from '../shared/error-notice';
import { ConfirmDialog } from '../shared/confirm-dialog';
import { DownloadPdfButton } from '../shared/download-pdf-button';
import { SearchSelect } from '../shared/search-select';
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

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

function emptyPaymentLine(): PaymentLine {
  return { income_category_id: '', amount: '' };
}

function emptyPaymentBlock(paymentPeriodId = '', paymentMethodId = ''): PaymentBlock {
  return { learner_id: '', enrolment_id: '', payment_period_id: paymentPeriodId, payment_method_id: paymentMethodId, lines: [emptyPaymentLine()] };
}

export function PaymentsView() {
  const { schoolId } = useCurrentSchoolId();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const ref = useSchoolReferenceData(schoolId);
  const { name: schoolName } = useSchoolName();
  const { hasLogo, stamp: logoStamp } = useSchoolLogo(schoolId);
  const [printingChargeId, setPrintingChargeId] = useState<number | null>(null);
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

  // Shared with the Reports page, which dates a period report's expenses the
  // same way.
  const currentAcademicYearId = useMemo(
    () => currentAcademicYear(ref.academicYears.data)?.academic_year_id,
    [ref.academicYears.data],
  );

  const currentAcademicYearName = ref.academicYears.data?.find(
    (year) => year.academic_year_id === currentAcademicYearId,
  )?.academic_year_name;

  /**
   * The payment period for the current month, when the school's periods are
   * months at all. A school running terms or quarters matches nothing here and
   * is left to pick for itself rather than being given a wrong default.
   */
  const currentPeriodId = useMemo(() => {
    const periods = ref.paymentPeriods.data;
    if (!periods?.length) return '';
    const thisMonth = MONTH_NAMES[new Date().getMonth()];
    const match = periods.find((period) => String(period.period_name ?? '').trim().toLowerCase() === thisMonth);
    return match ? String(match.payment_period_id) : '';
  }, [ref.paymentPeriods.data]);

  /**
   * Cash is what most fees are handed over as, so it is preselected when the
   * school has such a method. A school that names its methods differently
   * matches nothing and is left to pick, as with the period above.
   */
  const cashMethodId = useMemo(() => {
    const match = ref.paymentMethods.data?.find(
      (method) => String(method.method_name ?? '').trim().toLowerCase() === 'cash',
    );
    return match ? String(match.payment_method_id) : '';
  }, [ref.paymentMethods.data]);

  // The first block is built before the reference data arrives, so the defaults
  // are filled in once it does. Each is guarded separately — the two queries
  // resolve independently — and only ever once, so a value the user
  // deliberately cleared is not silently put back.
  const seededPeriod = useRef(false);
  const seededMethod = useRef(false);
  useEffect(() => {
    if (seededPeriod.current || !currentPeriodId) return;
    seededPeriod.current = true;
    setBlocks((current) => current.map((block) => (
      block.payment_period_id ? block : { ...block, payment_period_id: currentPeriodId }
    )));
  }, [currentPeriodId]);

  useEffect(() => {
    if (seededMethod.current || !cashMethodId) return;
    seededMethod.current = true;
    setBlocks((current) => current.map((block) => (
      block.payment_method_id ? block : { ...block, payment_method_id: cashMethodId }
    )));
  }, [cashMethodId]);

  const incomeOptions = useMemo(
    () => (ref.incomeCategories.data ?? []).map((income) => ({
      value: String(income.income_category_id),
      label: income.income_name,
      hint: income.income_limit === null || income.income_limit === undefined
        ? undefined
        : formatCurrency(income.income_limit),
    })),
    [ref.incomeCategories.data],
  );

  // Shown live in the dialog footer so the amount about to be taken is visible
  // before it is written. A blank or half-typed amount contributes nothing.
  const totalAmount = blocks.reduce(
    (sum, block) => sum + block.lines.reduce((lineSum, line) => lineSum + (Number(line.amount) || 0), 0),
    0,
  );

  // The table and the PDF export share these, so both always match.
  const activeFilters = {
    learner_id: filters.learner_id || null,
    class_name: filters.class_name || null,
    gender_name: filters.gender_name || null,
    academic_year: filters.academic_year || null,
    income_name: filters.income_name || null,
    payment_period: filters.payment_period || null,
    method_name: filters.method_name || null,
  };

  // Newest first, one page at a time — see components/shared/paged-list.tsx.
  const { query: paymentsQuery, rows: payments, totalCount: paymentsCount, totalAmount: paymentsTotal } = usePagedList({
    queryKey: ['payments', schoolId, filters],
    fetchPage: (cursor) => paymentsApi.listPage(schoolId!, activeFilters, cursor),
    enabled: !!schoolId,
  });

  // What each learner has already paid, per fee and period. Reuses the same
  // endpoint the Owing page uses, and is invalidated on every payment, so the
  // remaining amounts shown here stay in step with the server.
  const balancesQuery = useQuery({
    queryKey: ['balances', schoolId],
    queryFn: () => balancesApi.list(schoolId!),
    enabled: !!schoolId,
  });

  /**
   * Limit / paid / remaining for one payment line, or null when the fee has
   * no configured limit or the line isn't complete enough to price yet.
   * Mirrors the server's rule exactly, including counting earlier lines in
   * this same form so a bulk entry can't silently plan an overpayment.
   */
  const feeStatusFor = (
    block: PaymentBlock,
    blockIndex: number,
    lineIndex: number,
    // Lets the amount be priced against a category the moment it is picked,
    // before that choice has been written back into state.
    incomeCategoryId = block.lines[lineIndex].income_category_id,
  ) => {
    if (!block.learner_id || !block.payment_period_id || !incomeCategoryId) return null;

    const income = ref.incomeCategories.data?.find((i) => String(i.income_category_id) === incomeCategoryId);
    const period = ref.paymentPeriods.data?.find((p) => String(p.payment_period_id) === block.payment_period_id);
    if (!income || income.income_limit === null || income.income_limit === undefined || !period) return null;

    const limit = Number(income.income_limit);
    if (!Number.isFinite(limit)) return null;

    // Matched on academic year too: a mandatory fee's obligations are now
    // enumerated for every year a learner has ever been enrolled (so unpaid
    // prior-year fees still show on the Owing page), which means the same
    // learner+fee+period can appear once per year. Without the year match
    // here, a stale prior year's balance could get picked up for a payment
    // being recorded against the current year.
    const balanceRow = balancesQuery.data?.find((b) =>
      b.learner_id === block.learner_id
      && b.income_name === income.income_name
      && b.period_name === period.period_name
      && b.academic_year_name === currentAcademicYearName);
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
        if (otherLine.income_category_id !== incomeCategoryId) return;
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

  // Shares the ['learners', 'directory'] query LearnerAutocomplete already
  // keeps warm, so a receipt can show a learner's name/class right after
  // submission without a second round trip.
  const learnersDirectory = useQuery({ queryKey: ['learners', 'directory'], queryFn: () => learnersApi.list() });

  /**
   * The logo URL is made absolute here (rather than left relative, like the
   * sidebar uses it) because the receipt is rendered in a document with no
   * origin of its own — a bare data: URL for the desktop print window, a
   * detached popup document on the web — so a relative src would have
   * nothing to resolve against.
   */
  const printReceipt = async (data: Omit<Parameters<typeof buildReceiptHtml>[0], 'schoolName' | 'logoUrl'>) => {
    const logoUrl = hasLogo && schoolId
      ? `${window.location.origin}${schoolLogoUrl(schoolId, { size: 256, stamp: logoStamp })}`
      : null;
    await printHtml(buildReceiptHtml({ schoolName, logoUrl, ...data }));
  };

  /** Reprints one already-recorded payment row from the table below, as a single-line receipt. */
  const printReceiptFor = async (payment: Payment) => {
    setPrintingChargeId(payment.charge_id);
    try {
      await printReceipt({
        learnerName: `${payment.first_name} ${payment.last_name}`,
        learnerId: payment.learner_id,
        className: payment.class_name,
        academicYearName: payment.academic_year_name,
        methodName: payment.method_name,
        paidAt: payment.paid_at,
        referenceId: payment.charge_id,
        lines: [{ incomeName: payment.income_name, periodName: payment.period_name, amountLabel: formatCurrency(payment.amount) }],
        totalLabel: formatCurrency(payment.amount),
      });
    } catch (error) {
      toast({ title: 'Could not print receipt', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setPrintingChargeId(null);
    }
  };

  /**
   * One combined receipt per learner in a submission — several fees paid for
   * the same learner in one go print as a single transaction, not one receipt
   * per fee. Printed one after another (never in parallel), so at most one
   * print dialog is ever open at a time.
   *
   * Runs detached from the mutation: printing only finishes once the cashier
   * has dealt with every print dialog, and while it was awaited inside
   * onSuccess the mutation stayed pending that whole time — so the form
   * showed "Saving…" and refused a new payment long after this one had
   * already been saved.
   */
  const printReceiptsFor = async (result: CreatedChargeWithPayment[], inputs: CreateChargesWithPaymentsInput[]) => {
    // Let the closed dialog and the "Payment recorded" toast paint first, so
    // starting a print job can never hold up what the cashier sees.
    await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

    let cursor = 0;
    for (const input of inputs) {
      const created = result.slice(cursor, cursor + input.income_categories.length);
      cursor += input.income_categories.length;
      if (created.length === 0) continue;

      // Reference-data ids come back from Postgres as strings (bigint
      // columns are serialized as strings to avoid precision loss), but
      // the submitted input's ids are real numbers (Number()-converted
      // just above, for the API) — a strict === between them silently
      // failed every lookup here, which is why every line printed as the
      // generic "Fee" fallback with no period/method. Number() on the
      // reference-data side normalizes both to the same type.
      const learner = learnersDirectory.data?.find((l) => l.learner_id === input.learner_id);
      const period = ref.paymentPeriods.data?.find((p) => Number(p.payment_period_id) === input.payment_period_id);
      const year = ref.academicYears.data?.find((y) => String(y.academic_year_id) === String(input.academic_year_id));
      const method = ref.paymentMethods.data?.find((m) => Number(m.payment_method_id) === input.payment_method_id);

      const lines = created.map((entry, i) => {
        const income = ref.incomeCategories.data?.find((c) => Number(c.income_category_id) === input.income_categories[i].income_category_id);
        return {
          incomeName: income?.income_name ?? 'Fee',
          periodName: period?.period_name ?? '',
          amountLabel: formatCurrency(entry.payment.amount),
        };
      });
      const total = created.reduce((sum, entry) => sum + Number(entry.payment.amount), 0);

      try {
        await printReceipt({
          learnerName: learner ? `${learner.first_name} ${learner.last_name}` : input.learner_id,
          learnerId: input.learner_id,
          className: learner?.class_name ?? '',
          academicYearName: year?.academic_year_name ?? '',
          methodName: method?.method_name ?? '',
          paidAt: created[0].payment.paid_at,
          referenceId: created[0].charge.charge_id,
          lines,
          totalLabel: formatCurrency(total),
        });
      } catch (error) {
        toast({ title: 'Could not print receipt', description: (error as Error).message, variant: 'destructive' });
      }
    }
  };

  const recordPayment = useMutation({
    mutationFn: (inputs: CreateChargesWithPaymentsInput[]) => paymentsApi.create(inputs),
    onSuccess: (result, inputs) => {
      const recorded = inputs.reduce((count, input) => count + input.income_categories.length, 0);
      toast({ title: recorded === 1 ? 'Payment recorded' : `${recorded} payments recorded` });
      setAddOpen(false);
      // Reset only on success — a failed submission keeps every row so the
      // user can fix the problem instead of retyping the batch.
      setBlocks([emptyPaymentBlock(currentPeriodId, cashMethodId)]);
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['balances'] });
      // Deliberately not awaited — see printReceiptsFor.
      void printReceiptsFor(result, inputs);
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

  const addBlock = () => setBlocks((current) => [...current, emptyPaymentBlock(currentPeriodId, cashMethodId)]);

  const removeBlock = (index: number) => setBlocks((current) => current.filter((_, i) => i !== index));

  const addLine = (blockIndex: number) =>
    setBlocks((current) => current.map((block, i) => (
      i === blockIndex ? { ...block, lines: [...block.lines, emptyPaymentLine()] } : block
    )));

  /**
   * Choosing a fee also fills in the amount, since paying a fee off in full is
   * the common case. The figure offered is what is actually still payable —
   * the fee's limit less anything already paid and anything entered on earlier
   * lines of this form — so the prefilled value is never one the server would
   * reject. A fee already settled is left blank, with the note underneath
   * explaining why.
   */
  const chooseIncomeCategory = (blockIndex: number, lineIndex: number, incomeCategoryId: string) => {
    const block = blocks[blockIndex];
    const income = ref.incomeCategories.data?.find((i) => String(i.income_category_id) === incomeCategoryId);

    let amount = '';
    if (income) {
      const status = feeStatusFor(block, blockIndex, lineIndex, incomeCategoryId);
      const limit = Number(income.income_limit);
      const payable = status ? status.remaining : (Number.isFinite(limit) ? limit : 0);
      if (payable > 0) amount = String(payable);
    }

    updateLine(blockIndex, lineIndex, { income_category_id: incomeCategoryId, amount });
  };

  const removeLine = (blockIndex: number, lineIndex: number) =>
    setBlocks((current) => current.map((block, i) => (
      i === blockIndex ? { ...block, lines: block.lines.filter((_, l) => l !== lineIndex) } : block
    )));

  const formRef = useRef<HTMLFormElement>(null);

  // Focus starts on the form itself so the shortcuts below work the moment the
  // dialog opens, rather than only after something has been clicked.
  useEffect(() => {
    if (addOpen) formRef.current?.focus();
  }, [addOpen]);

  /**
   * Arrow-key shortcuts for building up a batch without reaching for the mouse:
   * down adds a fee line to the learner being worked on, up takes the last one
   * back, right adds another learner, left takes the last one back.
   *
   * The arrows already belong to the controls inside this form — they step an
   * amount up and down, move through a fee's options, and move the caret in a
   * text box — so while focus is in one of those the shortcut stays out of the
   * way and the control keeps the key. Holding Alt overrides that, which is
   * what makes the shortcuts usable without leaving the field you are typing
   * in. Both paths act on the last learner block, matching the order the form
   * is filled in.
   */
  const handleShortcut = (event: KeyboardEvent<HTMLFormElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;

    const target = event.target as HTMLElement | null;
    const inControl = !!target?.closest('input, select, textarea, [contenteditable="true"]');
    if (inControl && !event.altKey) return;

    event.preventDefault();
    const lastBlock = blocks.length - 1;
    if (lastBlock < 0) return;

    // A removal can take the focused button out of the tree with it, so focus
    // returns to the form and the next arrow still lands.
    const restoreFocus = () => formRef.current?.focus();

    switch (event.key) {
      case 'ArrowDown':
        addLine(lastBlock);
        break;
      case 'ArrowUp': {
        const lines = blocks[lastBlock].lines.length;
        // Never below one line: a learner block with no fee cannot be paid.
        if (lines > 1) {
          removeLine(lastBlock, lines - 1);
          restoreFocus();
        }
        break;
      }
      case 'ArrowRight':
        addBlock();
        break;
      case 'ArrowLeft':
        if (blocks.length > 1) {
          removeBlock(lastBlock);
          restoreFocus();
        }
        break;
    }
  };

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

    // A fee is no longer validated by the browser now that it is a search box,
    // so the same check the <select required> used to give is made here.
    for (const [blockIndex, block] of blocks.entries()) {
      const missingFee = block.lines.findIndex((line) => !line.income_category_id);
      if (missingFee === -1) continue;
      const which = blocks.length === 1 ? '' : `Learner ${blockIndex + 1}: `;
      const line = block.lines.length === 1 ? '' : `payment ${missingFee + 1}: `;
      toast({ title: `${which}${line}choose an income category`.replace(/^./, (c) => c.toUpperCase()), variant: 'destructive' });
      return;
    }

    // The year covering today rather than whichever record happens to be first,
    // so a payment is not attributed to a year that has already closed.
    const academicYearId = currentAcademicYearId;
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
        eyebrow="Money"
        title="Payments"
        detail="Record what a learner has paid, and see everything received. A receipt prints automatically once a payment is saved."
        action={schoolId ? <AddRecordButton label="Record payment" onClick={() => setAddOpen(true)} testId="button-open-record-payment" /> : undefined}
      />
      {!schoolId ? <NoSchoolNotice /> : (
        <>
          <FormDialog
            open={addOpen}
            width="xl"
            title={totalPayments === 1 ? 'Record a payment' : `Record ${totalPayments} payments`}
            description={`Recorded against ${currentAcademicYearName ?? 'the current academic year'}. Enrolment ID fills in automatically once a learner is selected.`}
            onClose={() => setAddOpen(false)}
          >
            {/* tabIndex lets the form hold focus itself, so an arrow pressed
                before anything is clicked still reaches the handler. */}
            <form ref={formRef} tabIndex={-1} onKeyDown={handleShortcut} onSubmit={submitPayment} className="space-y-4 outline-none">
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
                      <SearchSelect
                        options={incomeOptions}
                        value={line.income_category_id}
                        onSelect={(incomeCategoryId) => chooseIncomeCategory(blockIndex, lineIndex, incomeCategoryId)}
                        placeholder="Search income category…"
                        className="lg:col-span-2"
                        testId={`input-income-${blockIndex}-${lineIndex}`}
                      />
                      <div>
                        {(() => {
                          const status = feeStatusFor(block, blockIndex, lineIndex);
                          // A once-off fee is payable only in the periods it
                          // was set up for; the server refuses anything else,
                          // so say so before the cashier submits.
                          const income = ref.incomeCategories.data?.find((i) => String(i.income_category_id) === line.income_category_id);
                          const wrongOnceOffPeriod =
                            income?.priority === 'ONCE_OFF'
                            && !!block.payment_period_id
                            && !income.payment_period_ids.map(String).includes(block.payment_period_id);
                          const onceOffPeriods = wrongOnceOffPeriod
                            ? (ref.paymentPeriods.data ?? [])
                                .filter((p) => income!.payment_period_ids.map(String).includes(String(p.payment_period_id)))
                                .map((p) => p.period_name)
                                .join(', ')
                            : '';
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
                              {wrongOnceOffPeriod && (
                                <p className="mt-1 text-[10px] text-destructive" data-testid={`text-once-off-period-${blockIndex}-${lineIndex}`}>
                                  {income!.income_name} is a once-off payment for {onceOffPeriods || 'other periods'} only.
                                </p>
                              )}
                              {status && !wrongOnceOffPeriod && (
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

              <ErrorNotice error={recordPayment.error} />
              {/* Pinned to the bottom of the scroll area so the total and the
                  submit button stay reachable however many learners are open. */}
              <div className="sticky bottom-0 -mx-5 border-t border-border/60 bg-card px-5 pb-5 pt-3">
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {totalPayments === 1 ? 'Total' : `Total · ${totalPayments} payments`}
                  </span>
                  <span className="text-base font-semibold tabular-nums" data-testid="payments-total">{formatCurrency(totalAmount)}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <button type="button" onClick={addBlock} className="button-lift flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-background text-xs font-semibold text-foreground hover:border-primary/50" data-testid="button-add-payment-row"><Plus size={15} />Add another learner</button>
                  <button type="submit" disabled={recordPayment.isPending} className="button-lift flex h-10 items-center justify-center gap-2 rounded-lg bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-60 lg:col-span-2"><Plus size={15} />{submitLabel}</button>
                </div>
              </div>
            </form>
          </FormDialog>

          <div className="rounded-2xl border border-border/80 bg-card p-5">
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div><label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Learner name</label><LearnerAutocomplete placeholder="Search by name…" onSelect={(learner) => setFilters((f) => ({ ...f, learner_id: learner?.learner_id ?? '' }))} /></div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Class</label>
                <select value={filters.class_name} onChange={(e) => setFilters((f) => ({ ...f, class_name: e.target.value }))} className="field h-9 text-xs">
                  <option value="">All</option>
                  {ref.classCategories.data?.map((c) => <option key={c.class_category_id} value={c.class_name}>{c.class_name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Gender</label>
                <select value={filters.gender_name} onChange={(e) => setFilters((f) => ({ ...f, gender_name: e.target.value }))} className="field h-9 text-xs">
                  <option value="">All</option>
                  {ref.genders.data?.map((g) => <option key={g.gender_id} value={g.gender_name}>{g.gender_name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Academic year</label>
                <select value={filters.academic_year} onChange={(e) => setFilters((f) => ({ ...f, academic_year: e.target.value }))} className="field h-9 text-xs">
                  <option value="">All</option>
                  {ref.academicYears.data?.map((a) => <option key={a.academic_year_id} value={a.academic_year_name}>{a.academic_year_name}</option>)}
                </select>
              </div>
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
                  onDownload={() => paymentsApi.downloadPdf(schoolId, activeFilters)}
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
                  {!paymentsQuery.isLoading && payments.length === 0 && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={6}>No payments found</td></tr>}
                  {payments.map((payment) => (
                    <tr key={`${payment.payment_id}-${payment.charge_id}`}>
                      <td className="px-3 py-2">{payment.first_name} {payment.last_name}</td>
                      <td className="px-3 py-2">{payment.income_name}</td>
                      <td className="px-3 py-2">{payment.period_name}</td>
                      <td className="px-3 py-2">{payment.method_name}</td>
                      <td className="px-3 py-2 font-semibold">{formatCurrency(payment.amount)}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            title="Print receipt"
                            disabled={printingChargeId === payment.charge_id}
                            onClick={() => printReceiptFor(payment)}
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                            data-testid={`button-print-receipt-${payment.charge_id}`}
                          >
                            <Printer size={14} />
                          </button>
                          <button
                            type="button"
                            title="Delete this payment"
                            disabled={deleteCharge.isPending}
                            onClick={() => setPendingDeletePayment(payment)}
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ErrorNotice error={paymentsQuery.error} />
            </div>
            <PagedListFooter
              shown={payments.length}
              totalCount={paymentsCount}
              totalAmount={paymentsTotal}
              noun="payments"
              hasMore={!!paymentsQuery.hasNextPage}
              loadingMore={paymentsQuery.isFetchingNextPage}
              onLoadMore={() => paymentsQuery.fetchNextPage()}
              testId="payments-list"
            />
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
