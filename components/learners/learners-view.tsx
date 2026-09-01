'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useToast } from '../../app/components/hooks/use-toast';
import { useCurrentSchoolId } from '../../lib/client/current-school-id';
import { learnersApi } from '../../services/learners';
import type { CreateLearnerInput, Learner } from '../../types/learner';
import { useSchoolReferenceData } from '../reference-data/use-school-reference-data';
import { SectionHeading } from '../shared/section-heading';
import { NoSchoolNotice } from '../shared/no-school-notice';
import { ErrorNotice } from '../shared/error-notice';
import { ConfirmDialog } from '../shared/confirm-dialog';
import { LearnerAutocomplete } from './learner-autocomplete';

export function LearnersView() {
  const { schoolId } = useCurrentSchoolId();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const ref = useSchoolReferenceData(schoolId);
  const [filters, setFilters] = useState({ learner_id: '', class_name: '', gender_name: '', academic_year: '' });
  const [form, setForm] = useState({ first_name: '', last_name: '', gender_id: '', date_of_birth: '', class_category_id: '', academic_year_id: '' });
  const [pendingDelete, setPendingDelete] = useState<Learner | null>(null);

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
    mutationFn: (input: CreateLearnerInput) => learnersApi.create([input]),
    onSuccess: () => {
      toast({ title: 'Learner added' });
      setForm({ first_name: '', last_name: '', gender_id: '', date_of_birth: '', class_category_id: '', academic_year_id: '' });
      queryClient.invalidateQueries({ queryKey: ['learners'] });
    },
    onError: (error) => toast({ title: 'Could not add learner', description: (error as Error).message, variant: 'destructive' }),
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

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!schoolId) return;
    createLearner.mutate({
      school_id: schoolId,
      first_name: form.first_name,
      last_name: form.last_name,
      gender_id: Number(form.gender_id),
      date_of_birth: form.date_of_birth,
      class_category_id: Number(form.class_category_id),
      academic_year_id: Number(form.academic_year_id),
    });
  };

  return (
    <>
      <SectionHeading eyebrow="Learners" title="Learner records" detail="Fetched live from GET /api/learners. Filters map directly to the query parameters supported by the API." />
      {!schoolId ? <NoSchoolNotice /> : (
        <>
          <div className="rounded-2xl border border-border/80 bg-card p-5">
            <h3 className="text-sm font-semibold">Add a learner</h3>
            <form onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <input required placeholder="First name" value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} className="field" />
              <input required placeholder="Last name" value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))} className="field" />
              <input required type="date" value={form.date_of_birth} onChange={(e) => setForm((f) => ({ ...f, date_of_birth: e.target.value }))} className="field" />
              <select required value={form.gender_id} onChange={(e) => setForm((f) => ({ ...f, gender_id: e.target.value }))} className="field">
                <option value="">Gender…</option>
                {ref.genders.data?.map((g) => <option key={g.gender_id} value={g.gender_id}>{g.gender_name}</option>)}
              </select>
              <select required value={form.class_category_id} onChange={(e) => setForm((f) => ({ ...f, class_category_id: e.target.value }))} className="field">
                <option value="">Class…</option>
                {ref.classCategories.data?.map((c) => <option key={c.class_category_id} value={c.class_category_id}>{c.class_name}</option>)}
              </select>
              <select required value={form.academic_year_id} onChange={(e) => setForm((f) => ({ ...f, academic_year_id: e.target.value }))} className="field">
                <option value="">Academic year…</option>
                {ref.academicYears.data?.map((a) => <option key={a.academic_year_id} value={a.academic_year_id}>{a.academic_year_name}</option>)}
              </select>
              <button type="submit" disabled={createLearner.isPending} className="button-lift flex h-10 items-center justify-center gap-2 rounded-lg bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-60 sm:col-span-2 lg:col-span-3"><Plus size={15} />{createLearner.isPending ? 'Saving…' : 'Add learner'}</button>
            </form>
            {(!ref.genders.data?.length || !ref.classCategories.data?.length || !ref.academicYears.data?.length) && (
              <p className="mt-3 text-xs text-muted-foreground">Add at least one gender, class category and academic year in School setup before adding learners.</p>
            )}
            <ErrorNotice error={createLearner.error} />
          </div>

          <div className="mt-6 rounded-2xl border border-border/80 bg-card p-5">
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-56"><label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Learner name</label><LearnerAutocomplete placeholder="Search by name…" onSelect={(learner) => setFilters((f) => ({ ...f, learner_id: learner?.learner_id ?? '' }))} /></div>
              <div><label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Class</label><input value={filters.class_name} onChange={(e) => setFilters((f) => ({ ...f, class_name: e.target.value }))} placeholder="e.g. Grade 4" className="field h-9 w-36 text-xs" /></div>
              <div><label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Gender</label><input value={filters.gender_name} onChange={(e) => setFilters((f) => ({ ...f, gender_name: e.target.value }))} placeholder="e.g. Female" className="field h-9 w-36 text-xs" /></div>
              <div><label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Academic year</label><input value={filters.academic_year} onChange={(e) => setFilters((f) => ({ ...f, academic_year: e.target.value }))} placeholder="e.g. 2026" className="field h-9 w-36 text-xs" /></div>
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
