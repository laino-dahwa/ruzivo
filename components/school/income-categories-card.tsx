'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { useToast } from '../../app/components/hooks/use-toast';
import { incomeCategoriesApi } from '../../services/income-categories';
import type { ClassApplicability, ClassCategory, IncomeCategory, PaymentPeriod, PeriodApplicability } from '../../types/reference-data';
import { LearnerAutocomplete } from '../learners/learner-autocomplete';
import { MultiSelect } from '../reference-data/multi-select';
import { ConfirmDialog } from '../shared/confirm-dialog';

type FormState = {
  income_name: string;
  income_limit: string;
  priority: 'MANDATORY' | 'OPTIONAL';
  class_applicability: ClassApplicability;
  period_applicability: PeriodApplicability;
  class_category_ids: string[];
  payment_period_ids: string[];
};

const EMPTY_FORM: FormState = {
  income_name: '',
  income_limit: '',
  priority: 'MANDATORY',
  class_applicability: 'ALL_LEARNERS',
  period_applicability: 'ALL_PERIODS',
  class_category_ids: [],
  payment_period_ids: [],
};

/**
 * Income categories, with priority (Mandatory/Optional) and applicability
 * (which learners, which periods). Bespoke — not ReferenceListForm — because
 * that generic component only renders bare `<input>`s; this form needs a
 * priority dropdown plus two independently-conditional multi-selects, which
 * it has no way to express. Doubles as both the create and the edit form
 * (clicking "Edit" loads a row's values in; there is no inline row editing
 * here, unlike the simpler reference-data cards).
 */
export function IncomeCategoriesCard({
  schoolId,
  classCategories,
  paymentPeriods,
}: {
  schoolId: string;
  classCategories: ClassCategory[];
  paymentPeriods: PaymentPeriod[];
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [learnerTags, setLearnerTags] = useState<{ learner_id: string; label: string }[]>([]);
  const [learnerPickerKey, setLearnerPickerKey] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<IncomeCategory | null>(null);

  const categoriesQuery = useQuery({
    queryKey: ['income_categories', schoolId],
    queryFn: () => incomeCategoriesApi.list(schoolId),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['income_categories', schoolId] });

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setLearnerTags([]);
    setEditingId(null);
  };

  const buildPayload = () => ({
    school_id: schoolId,
    income_name: form.income_name,
    income_limit: form.income_limit || null,
    priority: form.priority,
    class_applicability: form.class_applicability,
    period_applicability: form.period_applicability,
    class_category_ids: form.class_applicability === 'SPECIFIC_CLASSES' ? form.class_category_ids.map(Number) : [],
    learner_ids: form.class_applicability === 'SPECIFIC_LEARNERS' ? learnerTags.map((tag) => tag.learner_id) : [],
    payment_period_ids: form.period_applicability === 'SPECIFIC_PERIODS' ? form.payment_period_ids.map(Number) : [],
  });

  const create = useMutation({
    mutationFn: () => incomeCategoriesApi.create(schoolId, [buildPayload()]),
    onSuccess: () => {
      toast({ title: 'Income category added' });
      resetForm();
      invalidate();
    },
    onError: (error) => toast({ title: 'Could not add income category', description: (error as Error).message, variant: 'destructive' }),
  });

  const update = useMutation({
    mutationFn: () => incomeCategoriesApi.update(schoolId, [{ ...buildPayload(), income_category_id: editingId! }]),
    onSuccess: () => {
      toast({ title: 'Income category updated' });
      resetForm();
      invalidate();
    },
    onError: (error) => toast({ title: 'Could not update income category', description: (error as Error).message, variant: 'destructive' }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => incomeCategoriesApi.remove(schoolId, id),
    onSuccess: () => {
      toast({ title: 'Income category deleted' });
      setPendingDelete(null);
      invalidate();
    },
    onError: (error) => {
      toast({ title: 'Could not delete income category', description: (error as Error).message, variant: 'destructive' });
      setPendingDelete(null);
    },
  });

  const startEdit = (row: IncomeCategory) => {
    setEditingId(row.income_category_id);
    setForm({
      income_name: row.income_name,
      income_limit: row.income_limit ?? '',
      priority: row.priority,
      class_applicability: row.class_applicability,
      period_applicability: row.period_applicability,
      class_category_ids: row.class_category_ids.map(String),
      payment_period_ids: row.payment_period_ids.map(String),
    });
    // Prior selections only carry an id back from the server, not a display
    // name — the id is shown as the tag's label until re-picked.
    setLearnerTags(row.learner_ids.map((id) => ({ learner_id: id, label: id })));
  };

  const saving = create.isPending || update.isPending;
  const classOptions = classCategories.map((c) => ({ value: String(c.class_category_id), label: c.class_name }));
  const periodOptions = paymentPeriods.map((p) => ({ value: String(p.payment_period_id), label: p.period_name }));

  return (
    <div className="rounded-2xl border border-border/80 bg-card p-5 lg:col-span-2">
      <h3 className="text-sm font-semibold">Income categories</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Mandatory fees are owed by every learner they apply to, even before a payment is made. Optional fees only ever appear for a learner once they&rsquo;ve engaged with them.
      </p>

      <form
        onSubmit={(event) => { event.preventDefault(); if (editingId) { update.mutate(); } else { create.mutate(); } }}
        className="mt-3 grid gap-3 sm:grid-cols-2"
      >
        <input required placeholder="Name" value={form.income_name} onChange={(e) => setForm((f) => ({ ...f, income_name: e.target.value }))} className="field" data-testid="input-income-name" />
        <input type="number" min="0" step="0.01" placeholder="Limit" value={form.income_limit} onChange={(e) => setForm((f) => ({ ...f, income_limit: e.target.value }))} className="field" data-testid="input-income-limit" />

        <div>
          <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Priority</label>
          <select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as FormState['priority'] }))} className="field" data-testid="select-income-priority">
            <option value="MANDATORY">Mandatory</option>
            <option value="OPTIONAL">Optional</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Applies to</label>
          <select value={form.class_applicability} onChange={(e) => setForm((f) => ({ ...f, class_applicability: e.target.value as FormState['class_applicability'] }))} className="field" data-testid="select-income-class-applicability">
            <option value="ALL_LEARNERS">All learners</option>
            <option value="SPECIFIC_CLASSES">Specific classes</option>
            <option value="SPECIFIC_LEARNERS">Specific learners</option>
          </select>
        </div>

        {form.class_applicability === 'SPECIFIC_CLASSES' && (
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Applicable classes</label>
            <MultiSelect options={classOptions} value={form.class_category_ids} onChange={(v) => setForm((f) => ({ ...f, class_category_ids: v }))} emptyMessage="No classes configured yet — add one above first." />
          </div>
        )}

        {form.class_applicability === 'SPECIFIC_LEARNERS' && (
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Applicable learners</label>
            <LearnerAutocomplete
              key={learnerPickerKey}
              placeholder="Search a learner to add…"
              onSelect={(learner) => {
                if (!learner) return;
                setLearnerTags((tags) => (
                  tags.some((tag) => tag.learner_id === learner.learner_id)
                    ? tags
                    : [...tags, { learner_id: learner.learner_id, label: `${learner.first_name} ${learner.last_name}` }]
                ));
                // LearnerAutocomplete has no external reset, so the picker is
                // remounted after each pick to clear its search box.
                setLearnerPickerKey((key) => key + 1);
              }}
            />
            {learnerTags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {learnerTags.map((tag) => (
                  <span key={tag.learner_id} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-1 text-[11px]">
                    {tag.label}
                    <button type="button" onClick={() => setLearnerTags((tags) => tags.filter((t) => t.learner_id !== tag.learner_id))} className="text-muted-foreground hover:text-destructive">
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <div>
          <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Applicable periods</label>
          <select value={form.period_applicability} onChange={(e) => setForm((f) => ({ ...f, period_applicability: e.target.value as FormState['period_applicability'] }))} className="field" data-testid="select-income-period-applicability">
            <option value="ALL_PERIODS">All periods</option>
            <option value="SPECIFIC_PERIODS">Selected periods</option>
          </select>
        </div>

        {form.period_applicability === 'SPECIFIC_PERIODS' && (
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Selected periods</label>
            <MultiSelect options={periodOptions} value={form.payment_period_ids} onChange={(v) => setForm((f) => ({ ...f, payment_period_ids: v }))} emptyMessage="No payment periods configured yet — add one above first." />
          </div>
        )}

        <div className="flex items-center gap-3 sm:col-span-2">
          <button type="submit" disabled={saving} className="button-lift flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-60" data-testid="button-save-income-category">
            <Plus size={15} />{saving ? 'Saving…' : editingId ? 'Save changes' : 'Add'}
          </button>
          {editingId && <button type="button" onClick={resetForm} className="text-xs font-semibold text-muted-foreground hover:text-foreground">Cancel</button>}
        </div>
      </form>

      <div className="mt-4 overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full text-left text-xs">
          <thead className="bg-secondary/60 text-[10px] uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-semibold">Name</th>
              <th className="px-3 py-2 font-semibold">Limit</th>
              <th className="px-3 py-2 font-semibold">Priority</th>
              <th className="px-3 py-2 font-semibold">Applies to</th>
              <th className="px-3 py-2 font-semibold">Periods</th>
              <th className="px-3 py-2 font-semibold"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {categoriesQuery.isLoading && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={6}>Loading…</td></tr>}
            {!categoriesQuery.isLoading && (categoriesQuery.data?.length ?? 0) === 0 && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={6}>No income categories yet</td></tr>}
            {categoriesQuery.data?.map((row) => (
              <tr key={row.income_category_id} data-testid={`row-income-category-${row.income_category_id}`}>
                <td className="px-3 py-2">{row.income_name}</td>
                <td className="px-3 py-2">{row.income_limit ?? '—'}</td>
                <td className="px-3 py-2">{row.priority === 'MANDATORY' ? 'Mandatory' : 'Optional'}</td>
                <td className="px-3 py-2">{applicabilityLabel(row, classCategories)}</td>
                <td className="px-3 py-2">{row.period_applicability === 'ALL_PERIODS' ? 'All' : `${row.payment_period_ids.length} selected`}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button type="button" title="Edit this income category" onClick={() => startEdit(row)} className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"><Pencil size={13} /></button>
                    <button type="button" title="Delete this income category" onClick={() => setPendingDelete(row)} className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 size={13} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete this income category?"
        description={pendingDelete ? `"${pendingDelete.income_name}" will be removed. Charges already using it are protected — the delete is refused if any exist.` : undefined}
        pending={remove.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete.income_category_id)}
      />
    </div>
  );
}

function applicabilityLabel(row: IncomeCategory, classCategories: ClassCategory[]) {
  if (row.class_applicability === 'ALL_LEARNERS') return 'All learners';
  if (row.class_applicability === 'SPECIFIC_LEARNERS') {
    return `${row.learner_ids.length} learner${row.learner_ids.length === 1 ? '' : 's'}`;
  }
  const names = classCategories
    .filter((c) => row.class_category_ids.includes(c.class_category_id))
    .map((c) => c.class_name);
  return names.length > 0 ? names.join(', ') : `${row.class_category_ids.length} class(es)`;
}
