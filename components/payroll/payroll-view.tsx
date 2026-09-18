'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Users, Wallet } from 'lucide-react';
import { useCurrentSchoolId } from '../../lib/client/current-school-id';
import { formatCurrency } from '../../lib/currency';
import { computePay, MONTH_NAMES, periodLabel } from '../../lib/payroll/compute';
import { payrollApi, type EmployeePay } from '../../services/payroll';
import { SectionHeading } from '../shared/section-heading';
import { NoSchoolNotice } from '../shared/no-school-notice';
import { ErrorNotice } from '../shared/error-notice';
import { MetricCard } from '../shared/metric-card';

/** The editable pay fields, as strings while they are being typed. */
type Draft = {
  basic_salary: string;
  transport_allowance: string;
  housing_allowance: string;
  paye_deduction: string;
  pension_deduction: string;
};

const PAY_FIELDS: { key: keyof Draft; label: string; kind: 'earning' | 'deduction' }[] = [
  { key: 'basic_salary', label: 'Basic salary', kind: 'earning' },
  { key: 'transport_allowance', label: 'Transport', kind: 'earning' },
  { key: 'housing_allowance', label: 'Housing', kind: 'earning' },
  { key: 'paye_deduction', label: 'PAYE', kind: 'deduction' },
  { key: 'pension_deduction', label: 'Pension', kind: 'deduction' },
];

function draftFrom(employee: EmployeePay): Draft {
  return {
    basic_salary: employee.basic_salary ?? '',
    transport_allowance: employee.transport_allowance ?? '0',
    housing_allowance: employee.housing_allowance ?? '0',
    paye_deduction: employee.paye_deduction ?? '0',
    pension_deduction: employee.pension_deduction ?? '0',
  };
}

export function PayrollView() {
  const { schoolId } = useCurrentSchoolId();
  const queryClient = useQueryClient();

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [savedId, setSavedId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const employees = useQuery({
    queryKey: ['payroll', schoolId],
    queryFn: () => payrollApi.listEmployees(schoolId!),
    enabled: !!schoolId,
  });

  const runs = useQuery({
    queryKey: ['payroll-runs', schoolId],
    queryFn: () => payrollApi.listRuns(schoolId!),
    enabled: !!schoolId,
  });

  const savePay = useMutation({
    mutationFn: (employee_id: number) => {
      const draft = drafts[employee_id];
      return payrollApi.updatePay(schoolId!, {
        employee_id,
        basic_salary: draft.basic_salary === '' ? null : Number(draft.basic_salary),
        transport_allowance: Number(draft.transport_allowance || 0),
        housing_allowance: Number(draft.housing_allowance || 0),
        paye_deduction: Number(draft.paye_deduction || 0),
        pension_deduction: Number(draft.pension_deduction || 0),
      });
    },
    onSuccess: (_result, employee_id) => {
      setSavedId(employee_id);
      window.setTimeout(() => setSavedId((current) => (current === employee_id ? null : current)), 2000);
      // Drop the local override so the row re-derives from the server. Keeping
      // it would leave "1500" sitting against a stored "1500.00" and the row
      // would look unsaved again the moment the refetch landed.
      setDrafts((current) => {
        const next = { ...current };
        delete next[employee_id];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['payroll', schoolId] });
    },
  });

  const generate = useMutation({
    mutationFn: () => payrollApi.generate(schoolId!, year, month),
    onSuccess: async (run) => {
      queryClient.invalidateQueries({ queryKey: ['payroll-runs', schoolId] });
      // The wage bill is posted as an expense, so anything reading expenses
      // (the dashboard, Reports, the Expenses page) is now stale.
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      await runAction(() => payrollApi.downloadPayslips(schoolId!, run.payroll_run_id, year, month));
    },
  });

  async function runAction(action: () => Promise<void>) {
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'That did not work.');
    }
  }

  const totals = useMemo(() => {
    const rows = (employees.data ?? []).filter((employee) => employee.basic_salary !== null);
    const pays = rows.map((employee) =>
      computePay({
        basic_salary: Number(employee.basic_salary ?? 0),
        transport_allowance: Number(employee.transport_allowance ?? 0),
        housing_allowance: Number(employee.housing_allowance ?? 0),
        paye_deduction: Number(employee.paye_deduction ?? 0),
        pension_deduction: Number(employee.pension_deduction ?? 0),
      })
    );
    return {
      onPayroll: rows.length,
      unset: (employees.data?.length ?? 0) - rows.length,
      gross: pays.reduce((sum, pay) => sum + pay.grossPay, 0),
      net: pays.reduce((sum, pay) => sum + pay.netPay, 0),
    };
  }, [employees.data]);

  const existingRun = runs.data?.find((run) => run.period_year === year && run.period_month === month);
  const years = Array.from({ length: 7 }, (_, index) => now.getFullYear() - 3 + index);

  return (
    <>
      <SectionHeading
        eyebrow="People"
        title="Staff pay and payslips"
        detail="Set what each member of staff is paid, then generate every payslip for a month in one PDF."
      />

      {!schoolId ? <NoSchoolNotice /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="On payroll" value={String(totals.onPayroll)} note={totals.unset > 0 ? `${totals.unset} without a salary` : 'Everyone has a salary'} icon={Users} />
            <MetricCard label="Monthly gross" value={formatCurrency(totals.gross)} note="Before deductions" icon={Wallet} />
            <MetricCard label="Monthly net" value={formatCurrency(totals.net)} note="Take-home total" icon={FileText} />
            <MetricCard label="Payroll runs" value={String(runs.data?.length ?? 0)} note="Months generated" icon={Download} />
          </div>

          <div className="mt-6 rounded-2xl border border-border/80 bg-card p-5">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Month</label>
                <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="field h-9 w-40 text-xs" data-testid="select-payroll-month">
                  {MONTH_NAMES.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Year</label>
                <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="field h-9 w-28 text-xs" data-testid="select-payroll-year">
                  {years.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </div>

              <button
                type="button"
                onClick={() => generate.mutate()}
                disabled={generate.isPending || totals.onPayroll === 0}
                className="button-lift flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                data-testid="button-generate-payslips"
              >
                <Download size={15} />
                {generate.isPending ? 'Generating…' : existingRun ? 'Regenerate payslips' : 'Generate payslips'}
              </button>

              {existingRun && (
                <p className="text-[11px] text-muted-foreground">
                  {periodLabel(year, month)} was generated on{' '}
                  {new Date(existingRun.generated_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} by {existingRun.generated_by_label}.
                  Regenerating replaces it with current figures.
                </p>
              )}
              {totals.onPayroll === 0 && <p className="text-[11px] text-muted-foreground">Enter at least one salary below first.</p>}
            </div>

            <p className="mt-2 text-[11px] text-muted-foreground">
              Generating also posts the month&apos;s total gross pay to Expenses under &ldquo;Salaries&rdquo;. Regenerating updates that
              same expense rather than adding another, so the wage bill is never counted twice.
            </p>

            <ErrorNotice error={generate.error} />
            {actionError && <p className="mt-2 text-xs text-destructive">{actionError}</p>}

            <div className="mt-5 overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full text-left text-xs">
                <thead className="bg-secondary/60 text-[10px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Employee</th>
                    <th className="px-3 py-2 font-semibold">Role</th>
                    {PAY_FIELDS.map((field) => (
                      <th key={field.key} className={`px-2 py-2 font-semibold ${field.kind === 'deduction' ? 'text-destructive/80' : ''}`}>{field.label}</th>
                    ))}
                    <th className="px-3 py-2 font-semibold">Net pay</th>
                    <th className="px-3 py-2 font-semibold"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {employees.isLoading && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={9}>Loading…</td></tr>}
                  {!employees.isLoading && (employees.data?.length ?? 0) === 0 && (
                    <tr><td className="px-3 py-3 text-muted-foreground" colSpan={9}>No staff yet — add them in School setup.</td></tr>
                  )}

                  {employees.data?.map((employee) => {
                    const draft = drafts[employee.employee_id] ?? draftFrom(employee);
                    const pay = computePay({
                      basic_salary: Number(draft.basic_salary || 0),
                      transport_allowance: Number(draft.transport_allowance || 0),
                      housing_allowance: Number(draft.housing_allowance || 0),
                      paye_deduction: Number(draft.paye_deduction || 0),
                      pension_deduction: Number(draft.pension_deduction || 0),
                    });
                    const changed = JSON.stringify(draft) !== JSON.stringify(draftFrom(employee));

                    return (
                      <tr key={employee.employee_id} data-testid={`row-payroll-${employee.employee_id}`}>
                        <td className="px-3 py-2">
                          <span className="font-medium">{employee.first_name} {employee.last_name}</span>
                          <span className="block text-[10px] text-muted-foreground">{employee.email}</span>
                        </td>
                        <td className="px-3 py-2">{employee.role_name}</td>

                        {PAY_FIELDS.map((field) => (
                          <td key={field.key} className="px-2 py-2">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={draft[field.key]}
                              placeholder={field.key === 'basic_salary' ? 'Not set' : '0'}
                              onChange={(e) =>
                                setDrafts((current) => ({
                                  ...current,
                                  [employee.employee_id]: { ...draft, [field.key]: e.target.value },
                                }))
                              }
                              className="field h-8 w-24 text-xs"
                              data-testid={`input-${field.key}-${employee.employee_id}`}
                            />
                          </td>
                        ))}

                        <td className="px-3 py-2 font-semibold">
                          {draft.basic_salary === '' ? <span className="text-muted-foreground">—</span> : formatCurrency(pay.netPay)}
                        </td>

                        <td className="px-3 py-2 text-right">
                          {savedId === employee.employee_id ? (
                            <span className="text-[10px] font-semibold text-primary">Saved</span>
                          ) : (
                            <button
                              type="button"
                              disabled={!changed || savePay.isPending}
                              onClick={() => savePay.mutate(employee.employee_id)}
                              className="rounded-md border border-border px-2.5 py-1 text-[10px] font-semibold disabled:opacity-40"
                              data-testid={`button-save-pay-${employee.employee_id}`}
                            >
                              Save
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <ErrorNotice error={employees.error ?? savePay.error} />
            </div>

            <p className="mt-3 text-[11px] text-muted-foreground">
              Staff without a basic salary are left out of payroll rather than issued a payslip for nothing.
            </p>
          </div>

          <div className="mt-6 rounded-2xl border border-border/80 bg-card p-5">
            <h3 className="text-xs font-semibold text-foreground">Previous payroll runs</h3>
            <p className="mt-1 text-[11px] text-muted-foreground">Each run keeps the figures as they stood that month, so a reprint shows what was actually paid.</p>

            <div className="mt-3 overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full text-left text-xs">
                <thead className="bg-secondary/60 text-[10px] uppercase text-muted-foreground">
                  <tr><th className="px-3 py-2 font-semibold">Period</th><th className="px-3 py-2 font-semibold">Staff</th><th className="px-3 py-2 font-semibold">Total gross</th><th className="px-3 py-2 font-semibold">Expense</th><th className="px-3 py-2 font-semibold">Generated</th><th className="px-3 py-2 font-semibold">By</th><th className="px-3 py-2 font-semibold"></th></tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {runs.isLoading && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={7}>Loading…</td></tr>}
                  {!runs.isLoading && (runs.data?.length ?? 0) === 0 && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={7}>No payroll generated yet.</td></tr>}

                  {runs.data?.map((run) => (
                    <tr key={run.payroll_run_id} data-testid={`row-payroll-run-${run.payroll_run_id}`}>
                      <td className="px-3 py-2 font-medium">{periodLabel(run.period_year, run.period_month)}</td>
                      <td className="px-3 py-2">{run.employee_count}</td>
                      <td className="px-3 py-2">{formatCurrency(run.total_gross)}</td>
                      <td className="px-3 py-2">
                        {run.expense_amount === null
                          ? <span className="text-[10px] text-muted-foreground">Removed</span>
                          : <span className="text-primary">{formatCurrency(run.expense_amount)}</span>}
                      </td>
                      <td className="px-3 py-2">{new Date(run.generated_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                      <td className="px-3 py-2">{run.generated_by_label}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          title="Download payslips"
                          onClick={() => runAction(() => payrollApi.downloadPayslips(schoolId, run.payroll_run_id, run.period_year, run.period_month))}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                          data-testid={`button-download-run-${run.payroll_run_id}`}
                        >
                          <Download size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ErrorNotice error={runs.error} />
            </div>
          </div>
        </>
      )}
    </>
  );
}
