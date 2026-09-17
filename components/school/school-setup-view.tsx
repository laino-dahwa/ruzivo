'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus } from 'lucide-react';
import { useToast } from '../../app/components/hooks/use-toast';
import { useCurrentSchoolId } from '../../lib/client/current-school-id';
import { schoolsApi, schoolExportApi } from '../../services/schools';
import {
  academicYearsApi,
  classCategoriesApi,
  expenseCategoriesApi,
  gendersApi,
  paymentMethodsApi,
  paymentPeriodsApi,
  rolesApi,
} from '../../services/reference-data';
import type { School } from '../../types/school';
import type { AcademicYear, ClassCategory, ExpenseCategory, Gender, PaymentMethod, PaymentPeriod, Role } from '../../types/reference-data';
import { useSchoolReferenceData } from '../reference-data/use-school-reference-data';
import { ReferenceListForm } from '../reference-data/reference-list-form';
import { SectionHeading } from '../shared/section-heading';
import { NoSchoolNotice } from '../shared/no-school-notice';
import { SchoolLogoCard } from './school-logo-card';
import { EmployeesCard } from './employees-card';
import { IncomeCategoriesCard } from './income-categories-card';
import { ErrorNotice } from '../shared/error-notice';

export function SchoolSetupView() {
  const { toast } = useToast();
  const { schoolId, setSchoolId } = useCurrentSchoolId();
  const queryClient = useQueryClient();
  const [lookupId, setLookupId] = useState('');
  const [schoolForm, setSchoolForm] = useState({ school_id: '', school_name: '', school_type: '', school_address: '', school_contact: '', school_email: '' });
  const [exporting, setExporting] = useState(false);

  const schoolQuery = useQuery({ queryKey: ['school', schoolId], queryFn: () => schoolsApi.get(schoolId!), enabled: !!schoolId });
  const school: School | undefined = schoolQuery.data?.[0];
  const ref = useSchoolReferenceData(schoolId);

  const createSchool = useMutation({
    mutationFn: () => schoolsApi.create([schoolForm]),
    onSuccess: (result) => {
      const created = result[0];
      // The API echoes school_id back as CHAR(4), i.e. padded — store the
      // trimmed form so it matches what the lookup path stores.
      setSchoolId((created?.school_id ?? schoolForm.school_id).trim());
      setSchoolForm({ school_id: '', school_name: '', school_type: '', school_address: '', school_contact: '', school_email: '' });
      toast({ title: 'School created', description: `${created?.school_name ?? schoolForm.school_name} is now active.` });
      queryClient.invalidateQueries();
    },
    onError: (error) => toast({ title: 'Could not create school', description: (error as Error).message, variant: 'destructive' }),
  });

  const invalidateRef = (key: string) => queryClient.invalidateQueries({ queryKey: [key, schoolId] });

  const lookupSchool = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const result = await schoolsApi.get(lookupId.trim());
      if (!result || result.length === 0) {
        toast({ title: 'School not found', description: `No school with id "${lookupId}"`, variant: 'destructive' });
        return;
      }
      setSchoolId(lookupId.trim());
      toast({ title: 'School selected', description: `Now viewing ${result[0]?.school_name ?? lookupId}` });
    } catch (error) {
      toast({ title: 'Lookup failed', description: (error as Error).message, variant: 'destructive' });
    }
  };

  const exportSchoolData = async () => {
    if (!schoolId) return;
    setExporting(true);
    try {
      await schoolExportApi.download(schoolId);
      toast({ title: 'School data exported' });
    } catch (error) {
      toast({ title: 'Could not export school data', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <SectionHeading eyebrow="Setup" title="School setup" detail="Create a school, or switch to an existing one, then manage the reference data required to add learners and payments." />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-border/80 bg-card p-5">
          <h3 className="text-sm font-semibold">Create a school</h3>
          <form onSubmit={(event) => { event.preventDefault(); createSchool.mutate(); }} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input required placeholder="School ID (e.g. SCH1)" maxLength={4} value={schoolForm.school_id} onChange={(e) => setSchoolForm((f) => ({ ...f, school_id: e.target.value.toUpperCase() }))} className="field" />
            <input required placeholder="School name" value={schoolForm.school_name} onChange={(e) => setSchoolForm((f) => ({ ...f, school_name: e.target.value }))} className="field" />
            <input required placeholder="School type" value={schoolForm.school_type} onChange={(e) => setSchoolForm((f) => ({ ...f, school_type: e.target.value }))} className="field" />
            <input required placeholder="Address" value={schoolForm.school_address} onChange={(e) => setSchoolForm((f) => ({ ...f, school_address: e.target.value }))} className="field" />
            <input required placeholder="Contact" value={schoolForm.school_contact} onChange={(e) => setSchoolForm((f) => ({ ...f, school_contact: e.target.value }))} className="field" />
            <input required type="email" placeholder="Email" value={schoolForm.school_email} onChange={(e) => setSchoolForm((f) => ({ ...f, school_email: e.target.value }))} className="field" />
            <button type="submit" disabled={createSchool.isPending} className="button-lift col-span-full flex h-10 items-center justify-center gap-2 rounded-lg bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-60"><Plus size={15} />{createSchool.isPending ? 'Creating…' : 'Create school'}</button>
          </form>
          <ErrorNotice error={createSchool.error} />
        </div>

        <div className="rounded-2xl border border-border/80 bg-card p-5">
          <h3 className="text-sm font-semibold">Switch active school</h3>
          <form onSubmit={lookupSchool} className="mt-3 flex gap-2">
            <input placeholder="Enter school ID" value={lookupId} onChange={(e) => setLookupId(e.target.value.toUpperCase())} className="field" />
            <button type="submit" className="button-lift shrink-0 rounded-lg border border-border bg-secondary px-4 text-xs font-semibold">Load</button>
          </form>
          {school && (
            <div className="mt-4 rounded-lg border border-border/60 p-3 text-xs">
              <p className="font-semibold">{school.school_name} ({school.school_id})</p>
              <p className="mt-1 text-muted-foreground">{school.school_type} · {school.school_address}</p>
              <p className="mt-1 text-muted-foreground">{school.school_contact} · {school.school_email}</p>
              <button
                type="button"
                onClick={exportSchoolData}
                disabled={exporting}
                data-testid="button-export-school-data"
                className="button-lift mt-3 flex h-9 items-center gap-2 rounded-lg border border-border bg-secondary px-3 text-xs font-semibold disabled:opacity-60"
              >
                <Download size={14} />{exporting ? 'Preparing…' : 'Export school data'}
              </button>
            </div>
          )}
        </div>
      </div>

      {!schoolId ? <div className="mt-6"><NoSchoolNotice /></div> : (
        <>
        <div className="mt-8"><SchoolLogoCard schoolId={schoolId} /></div>
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <ReferenceListForm<Role>
            title="Roles" rows={ref.roles.data} isLoading={ref.roles.isLoading}
            columns={[{ key: 'role_id', label: 'ID' }, { key: 'role_name', label: 'Name' }]}
            fields={[{ name: 'role_name', label: 'Name' }]}
            onCreate={(values) => rolesApi.create(schoolId, [{ school_id: schoolId, role_name: values.role_name }]).then(() => invalidateRef('roles'))}
            idKey="role_id" itemNoun="role"
            onUpdate={(id, values) => rolesApi.update(schoolId, [{ school_id: schoolId, role_id: id, ...{ role_name: values.role_name } }]).then(() => invalidateRef('roles'))}
            onDelete={(id) => rolesApi.remove(schoolId, 'role_id', id).then(() => invalidateRef('roles'))}
          />
          <ReferenceListForm<Gender>
            title="Genders" rows={ref.genders.data} isLoading={ref.genders.isLoading}
            columns={[{ key: 'gender_id', label: 'ID' }, { key: 'gender_name', label: 'Name' }]}
            fields={[{ name: 'gender_name', label: 'Name' }]}
            onCreate={(values) => gendersApi.create(schoolId, [{ school_id: schoolId, gender_name: values.gender_name }]).then(() => invalidateRef('genders'))}
            idKey="gender_id" itemNoun="gender"
            onUpdate={(id, values) => gendersApi.update(schoolId, [{ school_id: schoolId, gender_id: id, ...{ gender_name: values.gender_name } }]).then(() => invalidateRef('genders'))}
            onDelete={(id) => gendersApi.remove(schoolId, 'gender_id', id).then(() => invalidateRef('genders'))}
          />
          <ReferenceListForm<ClassCategory>
            title="Class categories" rows={ref.classCategories.data} isLoading={ref.classCategories.isLoading}
            columns={[{ key: 'class_category_id', label: 'ID' }, { key: 'class_name', label: 'Name' }]}
            fields={[{ name: 'class_name', label: 'Name' }]}
            onCreate={(values) => classCategoriesApi.create(schoolId, [{ school_id: schoolId, class_name: values.class_name }]).then(() => invalidateRef('class_categories'))}
            idKey="class_category_id" itemNoun="class category"
            onUpdate={(id, values) => classCategoriesApi.update(schoolId, [{ school_id: schoolId, class_category_id: id, ...{ class_name: values.class_name } }]).then(() => invalidateRef('class_categories'))}
            onDelete={(id) => classCategoriesApi.remove(schoolId, 'class_category_id', id).then(() => invalidateRef('class_categories'))}
          />
          <ReferenceListForm<AcademicYear>
            title="Academic years" rows={ref.academicYears.data} isLoading={ref.academicYears.isLoading}
            columns={[{ key: 'academic_year_id', label: 'ID' }, { key: 'academic_year_name', label: 'Name' }, { key: 'start_date', label: 'Start' }, { key: 'end_date', label: 'End' }]}
            fields={[{ name: 'academic_year_name', label: 'Name' }, { name: 'start_date', label: 'Start', type: 'date' }, { name: 'end_date', label: 'End', type: 'date' }]}
            onCreate={(values) => academicYearsApi.create(schoolId, [{ school_id: schoolId, academic_year_name: values.academic_year_name, start_date: values.start_date, end_date: values.end_date }]).then(() => invalidateRef('academic_years'))}
            idKey="academic_year_id" itemNoun="academic year"
            onUpdate={(id, values) => academicYearsApi.update(schoolId, [{ school_id: schoolId, academic_year_id: id, ...{ academic_year_name: values.academic_year_name, start_date: values.start_date, end_date: values.end_date } }]).then(() => invalidateRef('academic_years'))}
            onDelete={(id) => academicYearsApi.remove(schoolId, 'academic_year_id', id).then(() => invalidateRef('academic_years'))}
          />
          <ReferenceListForm<PaymentPeriod>
            title="Payment periods" rows={ref.paymentPeriods.data} isLoading={ref.paymentPeriods.isLoading}
            columns={[{ key: 'payment_period_id', label: 'ID' }, { key: 'period_name', label: 'Name' }]}
            fields={[{ name: 'period_name', label: 'Name' }]}
            onCreate={(values) => paymentPeriodsApi.create(schoolId, [{ school_id: schoolId, period_name: values.period_name }]).then(() => invalidateRef('payment_periods'))}
            idKey="payment_period_id" itemNoun="payment period"
            onUpdate={(id, values) => paymentPeriodsApi.update(schoolId, [{ school_id: schoolId, payment_period_id: id, ...{ period_name: values.period_name } }]).then(() => invalidateRef('payment_periods'))}
            onDelete={(id) => paymentPeriodsApi.remove(schoolId, 'payment_period_id', id).then(() => invalidateRef('payment_periods'))}
          />
          <ReferenceListForm<PaymentMethod>
            title="Payment methods" rows={ref.paymentMethods.data} isLoading={ref.paymentMethods.isLoading}
            columns={[{ key: 'payment_method_id', label: 'ID' }, { key: 'method_name', label: 'Name' }]}
            fields={[{ name: 'method_name', label: 'Name' }]}
            onCreate={(values) => paymentMethodsApi.create(schoolId, [{ school_id: schoolId, method_name: values.method_name }]).then(() => invalidateRef('payment_methods'))}
            idKey="payment_method_id" itemNoun="payment method"
            onUpdate={(id, values) => paymentMethodsApi.update(schoolId, [{ school_id: schoolId, payment_method_id: id, ...{ method_name: values.method_name } }]).then(() => invalidateRef('payment_methods'))}
            onDelete={(id) => paymentMethodsApi.remove(schoolId, 'payment_method_id', id).then(() => invalidateRef('payment_methods'))}
          />
          <ReferenceListForm<ExpenseCategory>
            title="Expense categories" rows={ref.expenseCategories.data} isLoading={ref.expenseCategories.isLoading}
            columns={[{ key: 'expense_category_id', label: 'ID' }, { key: 'expense_name', label: 'Name' }]}
            fields={[{ name: 'expense_name', label: 'Name' }]}
            onCreate={(values) => expenseCategoriesApi.create(schoolId, [{ school_id: schoolId, expense_name: values.expense_name }]).then(() => invalidateRef('expense_categories'))}
            idKey="expense_category_id" itemNoun="expense category"
            onUpdate={(id, values) => expenseCategoriesApi.update(schoolId, [{ school_id: schoolId, expense_category_id: id, ...{ expense_name: values.expense_name } }]).then(() => invalidateRef('expense_categories'))}
            onDelete={(id) => expenseCategoriesApi.remove(schoolId, 'expense_category_id', id).then(() => invalidateRef('expense_categories'))}
          />
        </div>
        <div className="mt-6"><IncomeCategoriesCard schoolId={schoolId} classCategories={ref.classCategories.data ?? []} paymentPeriods={ref.paymentPeriods.data ?? []} /></div>
        <div className="mt-6"><EmployeesCard schoolId={schoolId} roles={ref.roles.data ?? []} /></div>
        </>
      )}
    </>
  );
}
