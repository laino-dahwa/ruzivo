'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, CircleDollarSign, HandCoins, RotateCcw, ShieldAlert, Users } from 'lucide-react';
import { useCurrentSchoolId } from '../../lib/client/current-school-id';
import { currentAcademicYear } from '../../lib/client/current-academic-year';
import { formatCurrency } from '../../lib/currency';
import {
  feeKeyOf,
  groupExpectedFeesByLearner,
  rowId,
  sortExpectedFeeCards,
  type ExpectedFeeCard,
  type ExpectedFeeSort,
} from '../../lib/expected-fees/groupByLearner';
import { MAX_REASON_LENGTH } from '../../lib/expected-fees/parseAction';
import { expectedFeesApi } from '../../services/expected-fees';
import { learnersApi } from '../../services/learners';
import type {
  ExpectedFeeAction,
  ExpectedFeeActionResult,
  ExpectedFeeDecision,
  ExpectedFeeFilters,
  ExpectedFeeRow,
  FeeKey,
  FeePriority,
} from '../../types/expected-fees';
import { useToast } from '../../app/components/hooks/use-toast';
import { useSchoolReferenceData } from '../reference-data/use-school-reference-data';
import { LearnerAutocomplete } from '../learners/learner-autocomplete';
import { SectionHeading } from '../shared/section-heading';
import { NoSchoolNotice } from '../shared/no-school-notice';
import { ErrorNotice } from '../shared/error-notice';
import { DownloadPdfButton } from '../shared/download-pdf-button';
import { MetricCard } from '../shared/metric-card';
import { FormDialog } from '../shared/form-dialog';

/** Wording that changes with the decision filter: what the amounts on screen mean. */
const DECISION_COPY: Record<ExpectedFeeDecision, { option: string; amountLabel: string; total: string; empty: string }> = {
  PENDING: {
    option: 'Awaiting confirmation',
    amountLabel: 'awaiting confirmation',
    total: 'Awaiting confirmation',
    empty: 'Nothing is waiting for confirmation here.',
  },
  ACCEPTED: { option: 'Accepted', amountLabel: 'accepted', total: 'Accepted', empty: 'No accepted fees match these filters.' },
  SKIPPED: {
    option: 'Denied for one period',
    amountLabel: 'denied for these periods',
    total: 'Denied for one period',
    empty: 'No fees have been denied for a period here.',
  },
  EXEMPT: { option: 'Denied forever', amountLabel: 'per period, denied forever', total: 'Denied forever', empty: 'No learner is exempt from a fee here.' },
};

type DenyTarget = { row: ExpectedFeeRow; pendingForFee: number };
type BulkAccept = { scope: 'card' | 'filtered'; keys: FeeKey[]; total: number; learners: number; title: string };

/**
 * Expected fees: what the system suggests each learner should be paying, one
 * card per learner (the design the Learner owings page had), filtered like
 * the old Expected fees table. Nothing on this page is owed. Accepting a fee
 * turns it into a balance (Balances is the single source of truth for what
 * is owed); denying it skips it for its period, or for good with a reason.
 * docs/expected-fees.md has the rules.
 *
 * The decision filter switches between the fees still waiting (the default)
 * and the decisions already made, which is where they are undone.
 */
export function ExpectedFeesView() {
  const { schoolId } = useCurrentSchoolId();
  const ref = useSchoolReferenceData(schoolId);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [decision, setDecision] = useState<ExpectedFeeDecision>('PENDING');
  const [learnerId, setLearnerId] = useState('');
  const [classId, setClassId] = useState('');
  const [incomeId, setIncomeId] = useState('');
  const [priority, setPriority] = useState('');
  const [periodId, setPeriodId] = useState('');
  // null until the user picks a year, meaning "the year covering today";
  // '' is an explicit "All".
  const [yearChoice, setYearChoice] = useState<string | null>(null);
  const [sort, setSort] = useState<ExpectedFeeSort>('largest');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [denyTarget, setDenyTarget] = useState<DenyTarget | null>(null);
  const [bulkAccept, setBulkAccept] = useState<BulkAccept | null>(null);

  const defaultYearId = currentAcademicYear(ref.academicYears.data)?.academic_year_id;
  const yearId = yearChoice ?? (defaultYearId != null ? String(defaultYearId) : '');

  const filters: ExpectedFeeFilters = {
    decision,
    class_category_id: classId ? Number(classId) : null,
    learner_id: learnerId || null,
    income_category_id: incomeId ? Number(incomeId) : null,
    priority: (priority || null) as FeePriority | null,
    academic_year_id: yearId ? Number(yearId) : null,
    payment_period_id: periodId ? Number(periodId) : null,
  };

  const feesQuery = useQuery({
    queryKey: ['expected-fees', schoolId, filters],
    queryFn: () => expectedFeesApi.list(schoolId!, filters),
    // Waits for the year list so the first fetch already uses the current
    // year, rather than loading every year and then loading again.
    enabled: !!schoolId && !ref.academicYears.isLoading,
  });

  // Same query (and cache) the learner search box already keeps warm.
  const learnersDirectory = useQuery({ queryKey: ['learners', 'directory'], queryFn: () => learnersApi.list() });

  const rows = useMemo(() => feesQuery.data ?? [], [feesQuery.data]);
  const cards = useMemo(() => sortExpectedFeeCards(groupExpectedFeesByLearner(rows), sort), [rows, sort]);
  const summary = useMemo(() => ({
    total: cards.reduce((sum, card) => sum + card.total, 0),
    mandatory: cards.reduce((sum, card) => sum + card.mandatory, 0),
    optional: cards.reduce((sum, card) => sum + card.optional, 0),
  }), [cards]);

  const decide = useMutation({
    mutationFn: (action: ExpectedFeeAction) => expectedFeesApi.decide(schoolId!, action),
    onSuccess: (result, action) => {
      queryClient.invalidateQueries({ queryKey: ['expected-fees'] });
      // Accepting or withdrawing changes what is owed.
      queryClient.invalidateQueries({ queryKey: ['balances'] });
      toast(resultToast(action, result));
      setDenyTarget(null);
      setBulkAccept(null);
    },
    onError: (error) => toast({ title: 'Could not save the decision', description: (error as Error).message, variant: 'destructive' }),
  });

  const run = (action: ExpectedFeeAction) => decide.mutate(action);

  const keysOf = (list: ExpectedFeeRow[]) => list.map(feeKeyOf).filter((key): key is FeeKey => key !== null);

  const onRowAction = (row: ExpectedFeeRow, action: 'ACCEPT' | 'DENY' | 'UNDO') => {
    const key = feeKeyOf(row);
    if (action === 'ACCEPT' && key) return run({ action: 'ACCEPT', items: [key] });
    if (action === 'DENY') {
      const pendingForFee = rows.filter((r) => r.learner_id === row.learner_id && r.income_category_id === row.income_category_id).length;
      return setDenyTarget({ row, pendingForFee });
    }
    if (row.decision === 'EXEMPT') return run({ action: 'RESTORE', items: [{ learner_id: row.learner_id, income_category_id: row.income_category_id }] });
    if (key) run({ action: row.decision === 'ACCEPTED' ? 'UNDO_ACCEPT' : 'UNDO_SKIP', items: [key] });
  };

  const acceptCard = (card: ExpectedFeeCard) => setBulkAccept({
    scope: 'card',
    keys: keysOf(card.rows),
    total: card.total,
    learners: 1,
    title: `Accept all of ${card.first_name} ${card.last_name}'s expected fees?`,
  });

  const acceptFiltered = () => setBulkAccept({
    scope: 'filtered',
    keys: keysOf(rows),
    total: summary.total,
    learners: cards.length,
    title: 'Accept every expected fee shown?',
  });

  const toggleExpanded = (id: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const copy = DECISION_COPY[decision];
  const enrolled = learnersDirectory.data?.length;
  const pendingView = decision === 'PENDING';

  return (
    <>
      <SectionHeading
        eyebrow="Money"
        title="Expected fees"
        detail="Fees the system expects each learner to pay. Nothing here is owed until it is accepted: accepted fees move to Balances, which is what learners owe."
      />
      {!schoolId ? <NoSchoolNotice /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Learners" value={String(cards.length)} note={enrolled != null ? `of ${enrolled} enrolled` : 'In this view'} icon={Users} />
            <MetricCard label={copy.total} value={formatCurrency(summary.total)} note="Mandatory + optional" icon={CircleDollarSign} />
            <MetricCard label="Mandatory" value={formatCurrency(summary.mandatory)} note="Required of every learner" icon={ShieldAlert} />
            <MetricCard label="Optional" value={formatCurrency(summary.optional)} note="Fees learners opted into" icon={HandCoins} />
          </div>

          <div className="mt-6 rounded-2xl border border-border/80 bg-card p-5">
            <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="sm:col-span-2 lg:col-span-1">
                <FilterLabel>Learner</FilterLabel>
                <LearnerAutocomplete placeholder="Search by name…" onSelect={(learner) => setLearnerId(learner?.learner_id ?? '')} />
              </div>
              <Select label="Show" value={decision} onChange={(value) => setDecision(value as ExpectedFeeDecision)} testId="select-decision">
                {(Object.keys(DECISION_COPY) as ExpectedFeeDecision[]).map((key) => <option key={key} value={key}>{DECISION_COPY[key].option}</option>)}
              </Select>
              <Select label="Class" value={classId} onChange={setClassId}>
                <option value="">All</option>
                {ref.classCategories.data?.map((c) => <option key={c.class_category_id} value={c.class_category_id}>{c.class_name}</option>)}
              </Select>
              <Select label="Fee" value={incomeId} onChange={setIncomeId}>
                <option value="">All</option>
                {ref.incomeCategories.data?.map((i) => <option key={i.income_category_id} value={i.income_category_id}>{i.income_name}</option>)}
              </Select>
              <Select label="Priority" value={priority} onChange={setPriority}>
                <option value="">All</option>
                <option value="MANDATORY">Mandatory</option>
                <option value="OPTIONAL">Optional</option>
                <option value="ONCE_OFF">Once-off</option>
              </Select>
              <Select label="Academic year" value={yearId} onChange={setYearChoice} disabled={decision === 'EXEMPT'}>
                <option value="">All</option>
                {ref.academicYears.data?.map((y) => <option key={y.academic_year_id} value={y.academic_year_id}>{y.academic_year_name}</option>)}
              </Select>
              <Select label="Payment period" value={periodId} onChange={setPeriodId} disabled={decision === 'EXEMPT'}>
                <option value="">All</option>
                {ref.paymentPeriods.data?.map((p) => <option key={p.payment_period_id} value={p.payment_period_id}>{p.period_name}</option>)}
              </Select>
              <Select label="Sort by" value={sort} onChange={(value) => setSort(value as ExpectedFeeSort)}>
                <option value="largest">Largest amount</option>
                <option value="name">Name</option>
                <option value="class">Class</option>
              </Select>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              {pendingView && rows.length > 0 && (
                <button
                  type="button"
                  onClick={acceptFiltered}
                  disabled={decide.isPending}
                  className="button-lift flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                  data-testid="button-accept-all-filtered"
                >
                  <Check size={13} />Accept all shown ({rows.length})
                </button>
              )}
              <DownloadPdfButton disabled={feesQuery.isLoading} onDownload={() => expectedFeesApi.downloadPdf(schoolId!, filters)} />
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {feesQuery.isLoading
                  ? 'Loading…'
                  : `${cards.length} learner${cards.length === 1 ? '' : 's'} · ${rows.length} fee${rows.length === 1 ? '' : 's'}`}
              </span>
              <span className="hidden gap-4 text-[11px] sm:flex">
                <Legend className="bg-primary" label="Mandatory" />
                <Legend className="bg-accent" label="Optional & once-off" />
              </span>
            </div>

            <ErrorNotice error={feesQuery.error} />

            {!feesQuery.isLoading && cards.length === 0 && (
              <p className="mt-4 rounded-lg border border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">{copy.empty}</p>
            )}

            <div className="mt-3 grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
              {cards.map((card) => (
                <ExpectedFeeCardView
                  key={card.learner_id}
                  card={card}
                  decision={decision}
                  expanded={expanded.has(card.learner_id)}
                  busy={decide.isPending}
                  onToggle={() => toggleExpanded(card.learner_id)}
                  onAcceptAll={() => acceptCard(card)}
                  onRowAction={onRowAction}
                />
              ))}
            </div>
          </div>
        </>
      )}

      <DenyDialog
        target={denyTarget}
        pending={decide.isPending}
        onCancel={() => setDenyTarget(null)}
        onConfirm={(forever, reason) => {
          if (!denyTarget) return;
          const { row } = denyTarget;
          if (forever) run({ action: 'EXEMPT', items: [{ learner_id: row.learner_id, income_category_id: row.income_category_id }], reason });
          else {
            const key = feeKeyOf(row);
            if (key) run({ action: 'SKIP', items: [key] });
          }
        }}
      />

      <FormDialog open={bulkAccept !== null} title={bulkAccept?.title ?? ''} width="md" onClose={() => setBulkAccept(null)}>
        {bulkAccept && (
          <div className="p-5 pt-4">
            <p className="text-xs leading-5 text-muted-foreground">
              {bulkAccept.keys.length} fee{bulkAccept.keys.length === 1 ? '' : 's'}
              {bulkAccept.scope === 'filtered' ? ` for ${bulkAccept.learners} learner${bulkAccept.learners === 1 ? '' : 's'}` : ''} will move to Balances,
              and <span className="font-semibold text-foreground">{formatCurrency(bulkAccept.total)}</span> will be owed. Each fee can still be withdrawn
              later, as long as nothing has been paid toward it.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setBulkAccept(null)} className="rounded-lg px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary">Cancel</button>
              <button
                type="button"
                disabled={decide.isPending}
                onClick={() => run({ action: 'ACCEPT', items: bulkAccept.keys })}
                className="button-lift flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                data-testid="button-confirm-accept-all"
              >
                <Check size={13} />{decide.isPending ? 'Accepting…' : `Accept ${bulkAccept.keys.length}`}
              </button>
            </div>
          </div>
        )}
      </FormDialog>
    </>
  );
}

function resultToast(action: ExpectedFeeAction, result: ExpectedFeeActionResult): { title: string; description?: string } {
  const n = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
  const titles: Record<ExpectedFeeAction['action'], string> = {
    ACCEPT: `Accepted ${n(result.changed, 'fee')} · ${formatCurrency(result.amount)} now owed`,
    SKIP: `Denied ${n(result.changed, 'fee')} for this period`,
    EXEMPT: 'Denied forever',
    UNDO_ACCEPT: `Withdrew ${n(result.changed, 'fee')} back to expected fees`,
    UNDO_SKIP: `Brought back ${n(result.changed, 'fee')}`,
    RESTORE: 'Fee will be suggested again',
  };
  const description = result.unchanged > 0
    ? `${n(result.unchanged, 'fee')} had already been dealt with${action.action === 'UNDO_ACCEPT' ? ' or has payments' : ''}, so ${result.unchanged === 1 ? 'it was' : 'they were'} left as ${result.unchanged === 1 ? 'it was' : 'they were'}.`
    : undefined;
  return { title: result.changed === 0 ? 'Nothing changed' : titles[action.action], description };
}

function FilterLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">{children}</label>;
}

function Select({ label, value, onChange, disabled, testId, children }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <FilterLabel>{label}</FilterLabel>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="field h-9 text-xs disabled:opacity-50" data-testid={testId}>
        {children}
      </select>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-[2px] ${className}`} />{label}</span>;
}

function ExpectedFeeCardView({ card, decision, expanded, busy, onToggle, onAcceptAll, onRowAction }: {
  card: ExpectedFeeCard;
  decision: ExpectedFeeDecision;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onAcceptAll: () => void;
  onRowAction: (row: ExpectedFeeRow, action: 'ACCEPT' | 'DENY' | 'UNDO') => void;
}) {
  const share = (amount: number) => (card.total > 0 ? `${(amount / card.total) * 100}%` : '0%');
  const mandatory = card.rows.filter((row) => row.priority === 'MANDATORY');
  const optional = card.rows.filter((row) => row.priority !== 'MANDATORY');
  const count = card.rows.length;

  return (
    <div className="rounded-2xl border border-border/80 bg-background/55 p-[18px]" data-testid={`card-expected-fees-${card.learner_id}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{card.first_name} {card.last_name}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{card.class_name || 'No class'} · {card.learner_id}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-[3px] text-[9.5px] font-bold uppercase tracking-[.04em] ${BADGE_CLASS[decision]}`}>
          {count} {BADGE_NOUN[decision]}
        </span>
      </div>

      <p className="mt-3.5 flex items-baseline gap-1.5">
        <span className="text-[26px] font-semibold tracking-[-.045em]">{formatCurrency(card.total)}</span>
        <span className="text-[11px] text-muted-foreground">{DECISION_COPY[decision].amountLabel}</span>
      </p>

      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <span className="bg-primary" style={{ width: share(card.mandatory) }} />
        <span className="bg-accent" style={{ width: share(card.optional) }} />
      </div>

      <div className="mt-3 grid gap-1.5 text-xs">
        <SplitRow label="Mandatory" amount={card.mandatory} />
        <SplitRow label="Optional" amount={card.optional} />
      </div>

      {expanded && (
        <div className="mt-3 rounded-[10px] border border-border/70 bg-card px-3 py-2.5">
          {mandatory.length > 0 && <FeeGroup title="Mandatory" rows={mandatory} busy={busy} onRowAction={onRowAction} />}
          {optional.length > 0 && (
            <FeeGroup title={optional.some((row) => row.priority === 'ONCE_OFF') ? 'Optional & once-off' : 'Optional'} rows={optional} busy={busy} onRowAction={onRowAction} />
          )}
        </div>
      )}

      <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-border/70 pt-3 text-[11px] text-muted-foreground">
        {decision === 'PENDING' ? (
          <button
            type="button"
            onClick={onAcceptAll}
            disabled={busy}
            className="flex items-center gap-1 font-semibold text-primary hover:underline disabled:opacity-60"
            data-testid={`button-accept-card-${card.learner_id}`}
          >
            <Check size={12} />Accept all
          </button>
        ) : <span>{count} fee{count === 1 ? '' : 's'}</span>}
        <button type="button" onClick={onToggle} aria-expanded={expanded} className="font-semibold text-primary hover:underline" data-testid={`button-view-fees-${card.learner_id}`}>
          {expanded ? 'Hide fees ˄' : 'View fees ›'}
        </button>
      </div>
    </div>
  );
}

const BADGE_CLASS: Record<ExpectedFeeDecision, string> = {
  PENDING: 'bg-accent/35 text-accent-foreground',
  ACCEPTED: 'bg-[hsl(145_25%_42%/.15)] text-[hsl(145_25%_36%)]',
  SKIPPED: 'bg-secondary text-muted-foreground',
  EXEMPT: 'bg-destructive/10 text-destructive',
};

const BADGE_NOUN: Record<ExpectedFeeDecision, string> = {
  PENDING: 'to confirm',
  ACCEPTED: 'accepted',
  SKIPPED: 'skipped',
  EXEMPT: 'exempt',
};

function SplitRow({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${amount > 0 ? 'font-medium' : 'text-muted-foreground/70'}`}>{formatCurrency(amount)}</span>
    </div>
  );
}

function FeeGroup({ title, rows, busy, onRowAction }: {
  title: string;
  rows: ExpectedFeeRow[];
  busy: boolean;
  onRowAction: (row: ExpectedFeeRow, action: 'ACCEPT' | 'DENY' | 'UNDO') => void;
}) {
  return (
    <div className="[&+&]:mt-2.5">
      <p className="mb-1 text-[9.5px] font-bold uppercase tracking-[.14em] text-muted-foreground">{title}</p>
      {rows.map((row) => (
        <div key={rowId(row)} className="border-b border-border/40 py-1.5 last:border-b-0" data-testid={`row-expected-fee-${rowId(row)}`}>
          <div className="flex justify-between gap-3 text-xs">
            <span>
              {row.income_name}
              {row.period_name && <span className="text-muted-foreground"> · {row.period_name} {row.academic_year_name}</span>}
            </span>
            <span className="shrink-0 font-medium tabular-nums">{row.amount === null ? '—' : formatCurrency(row.amount)}</span>
          </div>
          <RowDetail row={row} />
          <RowActions row={row} busy={busy} onRowAction={onRowAction} />
        </div>
      ))}
    </div>
  );
}

function RowDetail({ row }: { row: ExpectedFeeRow }) {
  const parts: string[] = [];
  if (row.decision === 'ACCEPTED') {
    parts.push(row.source === 'PAYMENT' ? 'Accepted by a payment' : `Accepted${row.decided_by ? ` by ${row.decided_by}` : ''}`);
    if (Number(row.paid) > 0) parts.push(`${formatCurrency(row.paid)} paid`);
  }
  if (row.decision === 'SKIPPED') parts.push(`Denied for this period${row.decided_by ? ` by ${row.decided_by}` : ''}`);
  if (row.decision === 'EXEMPT') parts.push(`Denied forever${row.decided_by ? ` by ${row.decided_by}` : ''}: ${row.reason ?? ''}`);
  if (parts.length === 0) return null;
  return <p className="mt-0.5 text-[10.5px] text-muted-foreground">{parts.join(' · ')}</p>;
}

function RowActions({ row, busy, onRowAction }: {
  row: ExpectedFeeRow;
  busy: boolean;
  onRowAction: (row: ExpectedFeeRow, action: 'ACCEPT' | 'DENY' | 'UNDO') => void;
}) {
  const base = 'flex items-center gap-1 rounded-md px-2 py-[3px] text-[10.5px] font-semibold disabled:opacity-60';
  const id = rowId(row);

  if (row.decision === 'PENDING') {
    return (
      <div className="mt-1 flex justify-end gap-1.5">
        <button type="button" disabled={busy} onClick={() => onRowAction(row, 'DENY')} className={`${base} text-muted-foreground hover:bg-secondary`} data-testid={`button-deny-${id}`}>
          <Ban size={11} />Deny
        </button>
        <button type="button" disabled={busy} onClick={() => onRowAction(row, 'ACCEPT')} className={`${base} bg-primary/10 text-primary hover:bg-primary/15`} data-testid={`button-accept-${id}`}>
          <Check size={11} />Accept
        </button>
      </div>
    );
  }

  if (!row.can_undo) {
    return <p className="mt-0.5 text-right text-[10.5px] text-muted-foreground">Payments recorded, so this stays accepted</p>;
  }

  const label = row.decision === 'ACCEPTED' ? 'Withdraw' : row.decision === 'SKIPPED' ? 'Bring back' : 'Restore';
  return (
    <div className="mt-1 flex justify-end">
      <button type="button" disabled={busy} onClick={() => onRowAction(row, 'UNDO')} className={`${base} text-primary hover:bg-secondary`} data-testid={`button-undo-${id}`}>
        <RotateCcw size={11} />{label}
      </button>
    </div>
  );
}

/**
 * Deny asks how far: this period only (the fee comes back next period), or
 * forever (never suggested to this learner again; a reason is required).
 */
function DenyDialog({ target, pending, onCancel, onConfirm }: {
  target: DenyTarget | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (forever: boolean, reason: string) => void;
}) {
  const [forever, setForever] = useState(false);
  const [reason, setReason] = useState('');
  const [shownFor, setShownFor] = useState<string | null>(null);

  // A fresh choice every time the dialog opens for a different fee.
  const targetId = target ? rowId(target.row) : null;
  if (targetId !== shownFor) {
    setShownFor(targetId);
    setForever(false);
    setReason('');
  }

  if (!target) return null;
  const { row, pendingForFee } = target;
  const name = `${row.first_name} ${row.last_name}`;
  const period = [row.period_name, row.academic_year_name].filter(Boolean).join(' ');
  const canConfirm = !pending && (!forever || reason.trim().length > 0);

  return (
    <FormDialog open title={`Deny ${row.income_name} for ${name}?`} width="md" onClose={onCancel}>
      <div className="grid gap-2.5 p-5 pt-4 text-xs">
        <Choice
          checked={!forever}
          onChange={() => setForever(false)}
          title={`Just for ${period || 'this period'}`}
          detail={`${row.income_name} is suggested again next period.`}
          testId="radio-deny-period"
        />
        <Choice
          checked={forever}
          onChange={() => setForever(true)}
          title="Forever"
          detail={`${name} is never suggested ${row.income_name} again, in any period or year.${pendingForFee > 1 ? ` The ${pendingForFee} waiting periods of it shown here are removed too.` : ''} Fees already accepted or paid are not affected.`}
          testId="radio-deny-forever"
        />
        {forever && (
          <div>
            <FilterLabel>Reason (required)</FilterLabel>
            <textarea
              value={reason}
              maxLength={MAX_REASON_LENGTH}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. Scholarship, staff child, does not take the bus"
              className="field w-full py-2 text-xs"
              data-testid="input-deny-reason"
            />
          </div>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary">Cancel</button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={() => onConfirm(forever, reason.trim())}
            className="button-lift flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-xs font-semibold text-destructive-foreground disabled:opacity-60"
            data-testid="button-confirm-deny"
          >
            <Ban size={13} />{pending ? 'Saving…' : forever ? 'Deny forever' : 'Deny for this period'}
          </button>
        </div>
      </div>
    </FormDialog>
  );
}

function Choice({ checked, onChange, title, detail, testId }: { checked: boolean; onChange: () => void; title: string; detail: string; testId: string }) {
  return (
    <label className={`flex cursor-pointer gap-2.5 rounded-lg border p-3 ${checked ? 'border-primary/60 bg-primary/5' : 'border-border/70'}`}>
      <input type="radio" checked={checked} onChange={onChange} className="mt-0.5" data-testid={testId} />
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="mt-0.5 block leading-5 text-muted-foreground">{detail}</span>
      </span>
    </label>
  );
}
