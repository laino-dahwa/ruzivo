'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleDollarSign, HandCoins, ShieldAlert, Users } from 'lucide-react';
import { useCurrentSchoolId } from '../../lib/client/current-school-id';
import { currentAcademicYear } from '../../lib/client/current-academic-year';
import { formatCurrency } from '../../lib/currency';
import {
  groupObligationsByLearner,
  paymentProgress,
  sortLearnerOwings,
  type LearnerOwing,
  type LearnerOwingSort,
  type PaymentProgress,
} from '../../lib/owing/groupObligationsByLearner';
import { obligationsApi } from '../../services/obligations';
import { learnersApi } from '../../services/learners';
import type { ObligationFilters } from '../../types/payment';
import { useSchoolReferenceData } from '../reference-data/use-school-reference-data';
import { LearnerAutocomplete } from '../learners/learner-autocomplete';
import { SectionHeading } from '../shared/section-heading';
import { NoSchoolNotice } from '../shared/no-school-notice';
import { ErrorNotice } from '../shared/error-notice';
import { MetricCard } from '../shared/metric-card';

// Paid is the one colour the theme has no token for; a muted green reads as
// "settled" next to the terracotta (mandatory) and amber (optional) owing.
const PAID_BAR = 'bg-[hsl(145_25%_42%/.55)]';

const PROGRESS_BADGE: Record<PaymentProgress, { label: string; className: string }> = {
  NOTHING_PAID: { label: 'Nothing paid', className: 'bg-destructive/10 text-destructive' },
  PART_PAID: { label: 'Part paid', className: 'bg-accent/35 text-accent-foreground' },
  NEARLY_PAID: { label: 'Nearly paid', className: 'bg-[hsl(145_25%_42%/.15)] text-[hsl(145_25%_36%)]' },
  PAID_UP: { label: 'Paid up', className: 'bg-[hsl(145_25%_42%/.15)] text-[hsl(145_25%_36%)]' },
};

/**
 * One card per learner with their total owing across mandatory fees and the
 * optional fees they have opted into. Built on the same obligations engine as
 * the Expected fees page (docs/unpaid-mandatory.md has the rules), added up
 * per learner rather than listed per fee and period.
 *
 * Class, learner and academic year filter on the server; sorting and the
 * "show fully paid" switch only rearrange what is already loaded.
 */
export function LearnerOwingsView() {
  const { schoolId } = useCurrentSchoolId();
  const ref = useSchoolReferenceData(schoolId);
  const [learnerId, setLearnerId] = useState('');
  const [classId, setClassId] = useState('');
  // null until the user picks a year, meaning "the year covering today";
  // '' is an explicit "All".
  const [yearChoice, setYearChoice] = useState<string | null>(null);
  const [sort, setSort] = useState<LearnerOwingSort>('most-owing');
  const [showPaidUp, setShowPaidUp] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const defaultYearId = currentAcademicYear(ref.academicYears.data)?.academic_year_id;
  const yearId = yearChoice ?? (defaultYearId != null ? String(defaultYearId) : '');

  const serverFilters: ObligationFilters = {
    class_category_id: classId ? Number(classId) : null,
    learner_id: learnerId || null,
    academic_year_id: yearId ? Number(yearId) : null,
  };

  const obligationsQuery = useQuery({
    queryKey: ['obligations', schoolId, serverFilters],
    queryFn: () => obligationsApi.list(schoolId!, serverFilters),
    // Waits for the year list so the first fetch already uses the current
    // year, rather than loading every year and then loading again.
    enabled: !!schoolId && !ref.academicYears.isLoading,
  });

  // Same query (and cache) the learner search box already keeps warm.
  const learnersDirectory = useQuery({ queryKey: ['learners', 'directory'], queryFn: () => learnersApi.list() });

  const learners = useMemo(() => groupObligationsByLearner(obligationsQuery.data ?? []), [obligationsQuery.data]);
  const owing = useMemo(() => learners.filter((learner) => learner.totalOwing > 0), [learners]);
  const visible = useMemo(() => sortLearnerOwings(showPaidUp ? learners : owing, sort), [learners, owing, showPaidUp, sort]);

  const summary = useMemo(() => ({
    total: owing.reduce((sum, learner) => sum + learner.totalOwing, 0),
    mandatory: owing.reduce((sum, learner) => sum + learner.mandatoryOwing, 0),
    optional: owing.reduce((sum, learner) => sum + learner.optionalOwing, 0),
  }), [owing]);

  const toggleExpanded = (id: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const enrolled = learnersDirectory.data?.length;

  return (
    <>
      <SectionHeading
        eyebrow="Money"
        title="Learner owings"
        detail="What each learner still owes in total, across their mandatory fees and the optional ones they have signed up for."
      />
      {!schoolId ? <NoSchoolNotice /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Learners owing" value={String(owing.length)} note={enrolled != null ? `of ${enrolled} enrolled` : 'With something outstanding'} icon={Users} />
            <MetricCard label="Total owing" value={formatCurrency(summary.total)} note="Mandatory + optional" icon={CircleDollarSign} />
            <MetricCard label="Mandatory" value={formatCurrency(summary.mandatory)} note="Required of every learner" icon={ShieldAlert} />
            <MetricCard label="Optional" value={formatCurrency(summary.optional)} note="Fees learners opted into" icon={HandCoins} />
          </div>

          <div className="mt-6 rounded-2xl border border-border/80 bg-card p-5">
            <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto]">
              <div className="sm:col-span-2 lg:col-span-1">
                <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Learner</label>
                <LearnerAutocomplete placeholder="Search by name…" onSelect={(learner) => setLearnerId(learner?.learner_id ?? '')} />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Class</label>
                <select value={classId} onChange={(e) => setClassId(e.target.value)} className="field h-9 text-xs">
                  <option value="">All</option>
                  {ref.classCategories.data?.map((c) => <option key={c.class_category_id} value={c.class_category_id}>{c.class_name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Academic year</label>
                <select value={yearId} onChange={(e) => setYearChoice(e.target.value)} className="field h-9 text-xs">
                  <option value="">All</option>
                  {ref.academicYears.data?.map((y) => <option key={y.academic_year_id} value={y.academic_year_id}>{y.academic_year_name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Sort by</label>
                <select value={sort} onChange={(e) => setSort(e.target.value as LearnerOwingSort)} className="field h-9 text-xs">
                  <option value="most-owing">Most owing</option>
                  <option value="name">Name</option>
                  <option value="class">Class</option>
                </select>
              </div>
              <label className="flex h-9 cursor-pointer items-center gap-2 text-xs">
                <input type="checkbox" checked={showPaidUp} onChange={(e) => setShowPaidUp(e.target.checked)} className="peer sr-only" data-testid="toggle-show-paid-up" />
                <span className="relative h-[17px] w-[30px] shrink-0 rounded-full bg-secondary transition-colors after:absolute after:left-[2px] after:top-[2px] after:h-[13px] after:w-[13px] after:rounded-full after:bg-card after:shadow after:transition-transform peer-checked:bg-primary peer-checked:after:translate-x-[13px] peer-focus-visible:ring-2 peer-focus-visible:ring-ring" />
                Show fully paid
              </label>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {obligationsQuery.isLoading
                  ? 'Loading…'
                  : showPaidUp
                    ? `Showing ${visible.length} learner${visible.length === 1 ? '' : 's'}`
                    : `Showing ${visible.length} learner${visible.length === 1 ? '' : 's'} owing`}
              </span>
              <span className="hidden gap-4 text-[11px] sm:flex">
                <Legend className={PAID_BAR} label="Paid" />
                <Legend className="bg-primary" label="Mandatory owing" />
                <Legend className="bg-accent" label="Optional owing" />
              </span>
            </div>

            <ErrorNotice error={obligationsQuery.error} />

            {!obligationsQuery.isLoading && visible.length === 0 && (
              <p className="mt-4 rounded-lg border border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
                {learners.length > 0 ? 'Every learner here is fully paid.' : 'No learners match these filters.'}
              </p>
            )}

            <div className="mt-3 grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visible.map((learner) => (
                <LearnerOwingCard
                  key={learner.learner_id}
                  learner={learner}
                  expanded={expanded.has(learner.learner_id)}
                  onToggle={() => toggleExpanded(learner.learner_id)}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-[2px] ${className}`} />{label}</span>;
}

function LearnerOwingCard({ learner, expanded, onToggle }: { learner: LearnerOwing; expanded: boolean; onToggle: () => void }) {
  const badge = PROGRESS_BADGE[paymentProgress(learner)];
  const share = (amount: number) => (learner.billed > 0 ? `${(amount / learner.billed) * 100}%` : '0%');
  const mandatory = learner.outstanding.filter((row) => row.priority === 'MANDATORY');
  const optional = learner.outstanding.filter((row) => row.priority !== 'MANDATORY');

  return (
    <div className="rounded-2xl border border-border/80 bg-background/55 p-[18px]" data-testid={`card-learner-owing-${learner.learner_id}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{learner.first_name} {learner.last_name}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{learner.class_name} · {learner.learner_id}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-[3px] text-[9.5px] font-bold uppercase tracking-[.04em] ${badge.className}`}>{badge.label}</span>
      </div>

      <p className="mt-3.5 flex items-baseline gap-1.5">
        <span className="text-[26px] font-semibold tracking-[-.045em]">{formatCurrency(learner.totalOwing)}</span>
        <span className="text-[11px] text-muted-foreground">owing</span>
      </p>

      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <span className={PAID_BAR} style={{ width: share(learner.paid) }} />
        <span className="bg-primary" style={{ width: share(learner.mandatoryOwing) }} />
        <span className="bg-accent" style={{ width: share(learner.optionalOwing) }} />
      </div>

      <div className="mt-3 grid gap-1.5 text-xs">
        <SplitRow label="Mandatory" amount={learner.mandatoryOwing} />
        <SplitRow label="Optional" amount={learner.optionalOwing} />
      </div>

      {expanded && learner.outstanding.length > 0 && (
        <div className="mt-3 rounded-[10px] border border-border/70 bg-card px-3 py-2.5">
          {mandatory.length > 0 && <FeeGroup title="Mandatory" rows={mandatory} />}
          {optional.length > 0 && <FeeGroup title="Optional" rows={optional} />}
        </div>
      )}

      <div className="mt-3.5 flex items-center justify-between border-t border-border/70 pt-3 text-[11px] text-muted-foreground">
        <span>Paid {formatCurrency(learner.paid)} of {formatCurrency(learner.billed)}</span>
        {learner.outstanding.length > 0 && (
          <button type="button" onClick={onToggle} aria-expanded={expanded} className="font-semibold text-primary hover:underline">
            {expanded ? 'Hide fees ˄' : 'View fees ›'}
          </button>
        )}
      </div>
    </div>
  );
}

function SplitRow({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${amount > 0 ? 'font-medium' : 'text-muted-foreground/70'}`}>{formatCurrency(amount)}</span>
    </div>
  );
}

function FeeGroup({ title, rows }: { title: string; rows: LearnerOwing['outstanding'] }) {
  return (
    <div className="[&+&]:mt-2">
      <p className="mb-1 text-[9.5px] font-bold uppercase tracking-[.14em] text-muted-foreground">{title}</p>
      {rows.map((row, index) => (
        <div key={index} className="flex justify-between gap-3 py-[3px] text-xs">
          <span>
            {row.income_name} <span className="text-muted-foreground">· {row.period_name}</span>
            {Number(row.paid) > 0 && <span className="ml-1 text-[10px] text-muted-foreground">{formatCurrency(row.paid)} paid</span>}
          </span>
          <span className="shrink-0 font-medium tabular-nums text-destructive">{formatCurrency(row.balance ?? 0)}</span>
        </div>
      ))}
    </div>
  );
}
