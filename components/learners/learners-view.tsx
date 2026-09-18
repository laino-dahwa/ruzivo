'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useToast } from '../../app/components/hooks/use-toast';
import { useCurrentSchoolId } from '../../lib/client/current-school-id';
import { learnersApi } from '../../services/learners';
import type { CreateLearnerInput, Learner, UpdateLearnerInput } from '../../types/learner';
import { useSchoolReferenceData } from '../reference-data/use-school-reference-data';
import { SectionHeading } from '../shared/section-heading';
import { NoSchoolNotice } from '../shared/no-school-notice';
import { ErrorNotice } from '../shared/error-notice';
import { ConfirmDialog } from '../shared/confirm-dialog';
import { DownloadPdfButton } from '../shared/download-pdf-button';
import { AddRecordButton, FormDialog } from '../shared/form-dialog';
import { LearnerAutocomplete } from './learner-autocomplete';
import { EditLearnerDialog } from './edit-learner-dialog';

// One entry in the bulk form. Values stay as strings while being typed (the
// same as the original single-learner form) and are converted on submit.
type LearnerRow = {
  first_name: string;
  last_name: string;
  gender_id: string;
  date_of_birth: string;
  class_category_id: string;
  academic_year_id: string;
};

function emptyLearnerRow(): LearnerRow {
  return { first_name: '', last_name: '', gender_id: '', date_of_birth: '', class_category_id: '', academic_year_id: '' };
}

export function LearnersView() {
  const { schoolId } = useCurrentSchoolId();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const ref = useSchoolReferenceData(schoolId);
  const [filters, setFilters] = useState({ learner_id: '', class_name: '', gender_name: '', academic_year: '' });
  const [rows, setRows] = useState<LearnerRow[]>([emptyLearnerRow()]);
  const [pendingDelete, setPendingDelete] = useState<Learner | null>(null);
  const [editing, setEditing] = useState<Learner | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const learnersQuery = useQuery({
    queryKey: ['learners', filters],
    queryFn: () => learnersApi.list({
      learner_id: filters.learner_id || null,
      class_name: filters.class_name || null,
      gender_name: filters.gender_name || null,
      academic_year: filters.academic_year || null,
    }),
  });

  const createLearner = useMutation({
    mutationFn: (inputs: CreateLearnerInput[]) => learnersApi.create(inputs),
    onSuccess: (_result, inputs) => {
      toast({ title: inputs.length === 1 ? 'Learner added' : `${inputs.length} learners added` });
      setAddOpen(false);
      // Reset only on success — a failed submission keeps every row so the
      // user can fix the problem instead of retyping the whole batch.
      setRows([emptyLearnerRow()]);
      queryClient.invalidateQueries({ queryKey: ['learners'] });
    },
    onError: (error) => toast({ title: 'Could not add learners', description: (error as Error).message, variant: 'destructive' }),
  });

  const updateLearner = useMutation({
    mutationFn: (input: UpdateLearnerInput) => learnersApi.update([input]),
    onSuccess: () => {
      toast({ title: 'Learner updated' });
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ['learners'] });
    },
    // The dialog stays open so the rejected value (a duplicate academic year,
    // a reference row that has since been deleted) can be corrected in place.
    onError: (error) => toast({ title: 'Could not update learner', description: (error as Error).message, variant: 'destructive' }),
  });

  const deleteLearner = useMutation({
    mutationFn: (learnerId: string) => learnersApi.remove(learnerId),
    onSuccess: () => {
      toast({ title: 'Learner deleted' });
      setPendingDelete(null);
      queryClient.invalidateQueries({ queryKey: ['learners'] });
    },
    onError: (error) => toast({ title: 'Could not delete learner', description: (error as Error).message, variant: 'destructive' }),
  });

  const updateRow = (index: number, patch: Partial<LearnerRow>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const addRow = () => setRows((current) => [...current, emptyLearnerRow()]);

  const removeRow = (index: number) => setRows((current) => current.filter((_, i) => i !== index));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!schoolId) return;
    // Every row is sent as one array in a single request, and written by the
    // API in a single transaction.
    createLearner.mutate(rows.map((row) => ({
      school_id: schoolId,
      first_name: row.first_name,
      last_name: row.last_name,
      gender_id: Number(row.gender_id),
      date_of_birth: row.date_of_birth,
      class_category_id: Number(row.class_category_id),
      academic_year_id: Number(row.academic_year_id),
    })));
  };

  return (
    <>
      <SectionHeading
        eyebrow="People"
        title="Learners"
        detail="Everyone enrolled at the school. Narrow the list with the filters, then download it if you need it on paper."
        action={schoolId ? <AddRecordButton label="Add learner" onClick={() => setAddOpen(true)} testId="button-open-add-learner" /> : undefined}
      />
      {!schoolId ? <NoSchoolNotice /> : (
        <>
          <FormDialog
            open={addOpen}
            title={rows.length === 1 ? 'Add a learner' : `Add ${rows.length} learners`}
            onClose={() => setAddOpen(false)}
          >
            <form onSubmit={submit} className="space-y-3 pb-5">
              {rows.map((row, index) => (
                <div key={index} className="space-y-2">
                  {rows.length > 1 && (
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Learner {index + 1}</span>
                      <button
                        type="button"
                        title="Remove this learner"
                        onClick={() => removeRow(index)}
                        className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <input required placeholder="First name" value={row.first_name} onChange={(e) => updateRow(index, { first_name: e.target.value })} className="field" />
                    <input required placeholder="Last name" value={row.last_name} onChange={(e) => updateRow(index, { last_name: e.target.value })} className="field" />
                    <input required type="date" value={row.date_of_birth} onChange={(e) => updateRow(index, { date_of_birth: e.target.value })} className="field" />
                    <select required value={row.gender_id} onChange={(e) => updateRow(index, { gender_id: e.target.value })} className="field">
                      <option value="">Gender…</option>
                      {ref.genders.data?.map((g) => <option key={g.gender_id} value={g.gender_id}>{g.gender_name}</option>)}
                    </select>
                    <select required value={row.class_category_id} onChange={(e) => updateRow(index, { class_category_id: e.target.value })} className="field">
                      <option value="">Class…</option>
                      {ref.classCategories.data?.map((c) => <option key={c.class_category_id} value={c.class_category_id}>{c.class_name}</option>)}
                    </select>
                    <select required value={row.academic_year_id} onChange={(e) => updateRow(index, { academic_year_id: e.target.value })} className="field">
                      <option value="">Academic year…</option>
                      {ref.academicYears.data?.map((a) => <option key={a.academic_year_id} value={a.academic_year_id}>{a.academic_year_name}</option>)}
                    </select>
                  </div>
                </div>
              ))}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <button type="button" onClick={addRow} className="button-lift flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-background text-xs font-semibold text-foreground hover:border-primary/50" data-testid="button-add-learner-row"><Plus size={15} />Add another</button>
                <button type="submit" disabled={createLearner.isPending} className="button-lift flex h-10 items-center justify-center gap-2 rounded-lg bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-60 lg:col-span-2"><Plus size={15} />{createLearner.isPending ? 'Saving…' : rows.length === 1 ? 'Add learner' : `Add ${rows.length} learners`}</button>
              </div>
            </form>
            {(!ref.genders.data?.length || !ref.classCategories.data?.length || !ref.academicYears.data?.length) && (
              <p className="mt-3 text-xs text-muted-foreground">Add at least one gender, class category and academic year in School setup before adding learners.</p>
            )}
            <ErrorNotice error={createLearner.error} />
          </FormDialog>

          <div className="rounded-2xl border border-border/80 bg-card p-5">
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-56"><label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Learner name</label><LearnerAutocomplete placeholder="Search by name…" onSelect={(learner) => setFilters((f) => ({ ...f, learner_id: learner?.learner_id ?? '' }))} /></div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Class</label>
                <select value={filters.class_name} onChange={(e) => setFilters((f) => ({ ...f, class_name: e.target.value }))} className="field h-9 w-36 text-xs">
                  <option value="">All</option>
                  {ref.classCategories.data?.map((c) => <option key={c.class_category_id} value={c.class_name}>{c.class_name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Gender</label>
                <select value={filters.gender_name} onChange={(e) => setFilters((f) => ({ ...f, gender_name: e.target.value }))} className="field h-9 w-36 text-xs">
                  <option value="">All</option>
                  {ref.genders.data?.map((g) => <option key={g.gender_id} value={g.gender_name}>{g.gender_name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Academic year</label>
                <select value={filters.academic_year} onChange={(e) => setFilters((f) => ({ ...f, academic_year: e.target.value }))} className="field h-9 w-36 text-xs">
                  <option value="">All</option>
                  {ref.academicYears.data?.map((a) => <option key={a.academic_year_id} value={a.academic_year_name}>{a.academic_year_name}</option>)}
                </select>
              </div>
              <div className="ml-auto">
                <DownloadPdfButton
                  disabled={learnersQuery.isLoading}
                  onDownload={() => learnersApi.downloadPdf({
                    learner_id: filters.learner_id || null,
                    class_name: filters.class_name || null,
                    gender_name: filters.gender_name || null,
                    academic_year: filters.academic_year || null,
                  })}
                />
              </div>
            </div>
            <div className="mt-4 overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full text-left text-xs">
                <thead className="bg-secondary/60 text-[10px] uppercase text-muted-foreground">
                  <tr><th className="px-3 py-2 font-semibold">Learner ID</th><th className="px-3 py-2 font-semibold">Name</th><th className="px-3 py-2 font-semibold">Gender</th><th className="px-3 py-2 font-semibold">Class</th><th className="px-3 py-2 font-semibold">Year</th><th className="px-3 py-2 font-semibold"></th></tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {learnersQuery.isLoading && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={6}>Loading…</td></tr>}
                  {!learnersQuery.isLoading && (learnersQuery.data?.length ?? 0) === 0 && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={6}>No learners found</td></tr>}
                  {learnersQuery.data?.map((learner) => (
                    <tr key={learner.learner_id} data-testid={`row-learner-${learner.learner_id}`}>
                      <td className="px-3 py-2 font-mono">{learner.learner_id}</td>
                      <td className="px-3 py-2">{learner.first_name} {learner.last_name}</td>
                      <td className="px-3 py-2">{learner.gender_name}</td>
                      <td className="px-3 py-2">{learner.class_name}</td>
                      <td className="px-3 py-2">{learner.curent_year}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          title="Edit this learner"
                          onClick={() => setEditing(learner)}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                          data-testid={`button-edit-${learner.learner_id}`}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          title="Delete this learner"
                          onClick={() => setPendingDelete(learner)}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ErrorNotice error={learnersQuery.error} />
          </div>
        </>
      )}
      <EditLearnerDialog
        learner={editing}
        genders={ref.genders.data}
        classCategories={ref.classCategories.data}
        academicYears={ref.academicYears.data}
        pending={updateLearner.isPending}
        onSave={(values) => updateLearner.mutate(values)}
        onCancel={() => setEditing(null)}
      />
      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete this learner?"
        description={pendingDelete ? `${pendingDelete.first_name} ${pendingDelete.last_name} (${pendingDelete.learner_id}) will be removed from active records.` : undefined}
        pending={deleteLearner.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => { if (pendingDelete) deleteLearner.mutate(pendingDelete.learner_id); }}
      />
    </>
  );
}
