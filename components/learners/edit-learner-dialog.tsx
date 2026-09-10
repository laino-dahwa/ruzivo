'use client';

import { useState, type FormEvent } from 'react';
import { Save } from 'lucide-react';
import type { Learner, UpdateLearnerInput } from '../../types/learner';
import type { AcademicYear, ClassCategory, Gender } from '../../types/reference-data';
import { FormDialog } from '../shared/form-dialog';

// Mirrors the add-learner form: values stay as strings while being edited and
// are converted on submit.
type EditForm = {
  first_name: string;
  last_name: string;
  gender_id: string;
  date_of_birth: string;
  class_category_id: string;
  academic_year_id: string;
};

export function editFormFor(learner: Learner): EditForm {
  return {
    first_name: learner.first_name ?? '',
    last_name: learner.last_name ?? '',
    // date_of_birth arrives as YYYY-MM-DD, which is exactly what a date input
    // expects — no parsing, and no timezone shift on the way in.
    date_of_birth: learner.date_of_birth ?? '',
    gender_id: String(learner.gender_id ?? ''),
    class_category_id: String(learner.class_category_id ?? ''),
    academic_year_id: String(learner.academic_year_id ?? ''),
  };
}

export function EditLearnerDialog({
  learner,
  genders,
  classCategories,
  academicYears,
  pending,
  onSave,
  onCancel,
}: {
  learner: Learner | null;
  genders: Gender[] | undefined;
  classCategories: ClassCategory[] | undefined;
  academicYears: AcademicYear[] | undefined;
  pending?: boolean;
  onSave: (values: UpdateLearnerInput) => void;
  onCancel: () => void;
}) {
  return (
    <FormDialog
      open={!!learner}
      title="Edit learner"
      description={learner ? (
        <>Learner ID <span className="font-mono text-foreground">{learner.learner_id}</span> is permanent and cannot be changed.</>
      ) : undefined}
      onClose={onCancel}
    >
      {/* Keyed on the learner id so opening a different row remounts the form
          and reseeds the fields, rather than keeping the previous learner's
          values. */}
      {learner && (
        <EditLearnerForm
          key={learner.learner_id}
          learner={learner}
          genders={genders}
          classCategories={classCategories}
          academicYears={academicYears}
          pending={pending}
          onSave={onSave}
          onCancel={onCancel}
        />
      )}
    </FormDialog>
  );
}

function EditLearnerForm({
  learner,
  genders,
  classCategories,
  academicYears,
  pending,
  onSave,
  onCancel,
}: {
  learner: Learner;
  genders: Gender[] | undefined;
  classCategories: ClassCategory[] | undefined;
  academicYears: AcademicYear[] | undefined;
  pending?: boolean;
  onSave: (values: UpdateLearnerInput) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<EditForm>(() => editFormFor(learner));

  const update = (patch: Partial<EditForm>) => setForm((current) => ({ ...current, ...patch }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({
      // learner_id identifies the record and is never sent as an edit — every
      // dependent table (enrolments, charges, payments) references it.
      learner_id: learner.learner_id,
      enrolment_id: Number(learner.enrolment_id),
      first_name: form.first_name,
      last_name: form.last_name,
      gender_id: Number(form.gender_id),
      date_of_birth: form.date_of_birth,
      class_category_id: Number(form.class_category_id),
      academic_year_id: Number(form.academic_year_id),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3 pb-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">First name</label>
          <input required value={form.first_name} onChange={(e) => update({ first_name: e.target.value })} className="field" data-testid="input-edit-first-name" />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Last name</label>
          <input required value={form.last_name} onChange={(e) => update({ last_name: e.target.value })} className="field" data-testid="input-edit-last-name" />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Date of birth</label>
          <input required type="date" value={form.date_of_birth} onChange={(e) => update({ date_of_birth: e.target.value })} className="field" data-testid="input-edit-dob" />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Gender</label>
          <select required value={form.gender_id} onChange={(e) => update({ gender_id: e.target.value })} className="field" data-testid="select-edit-gender">
            <option value="">Gender…</option>
            {genders?.map((g) => <option key={g.gender_id} value={g.gender_id}>{g.gender_name}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Class</label>
          <select required value={form.class_category_id} onChange={(e) => update({ class_category_id: e.target.value })} className="field" data-testid="select-edit-class">
            <option value="">Class…</option>
            {classCategories?.map((c) => <option key={c.class_category_id} value={c.class_category_id}>{c.class_name}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Academic year</label>
          <select required value={form.academic_year_id} onChange={(e) => update({ academic_year_id: e.target.value })} className="field" data-testid="select-edit-year">
            <option value="">Academic year…</option>
            {academicYears?.map((a) => <option key={a.academic_year_id} value={a.academic_year_id}>{a.academic_year_name}</option>)}
          </select>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary">Cancel</button>
        <button type="submit" disabled={pending} className="button-lift flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60" data-testid="button-save-learner">
          <Save size={13} />{pending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
