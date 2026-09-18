import { request } from './http';
import { downloadFileFrom } from './pdf';

export type EmployeePay = {
  employee_id: number;
  first_name: string;
  last_name: string;
  email: string;
  role_name: string;
  basic_salary: string | null;
  transport_allowance: string;
  housing_allowance: string;
  paye_deduction: string;
  pension_deduction: string;
};

export type PayrollRun = {
  payroll_run_id: number;
  period_year: number;
  period_month: number;
  generated_by_label: string;
  generated_at: string;
  employee_count: number;
  total_gross: string;
  /** Null only if the posted expense was later deleted by hand. */
  expense_amount: string | null;
};

export type EmployeePayUpdate = {
  employee_id: number;
  basic_salary: number | null;
  transport_allowance: number;
  housing_allowance: number;
  paye_deduction: number;
  pension_deduction: number;
};

function base(schoolId: string) {
  return `/api/schools/${encodeURIComponent(schoolId)}/payroll`;
}

export const payrollApi = {
  listEmployees: (schoolId: string) => request<EmployeePay[]>(base(schoolId)),

  updatePay: (schoolId: string, update: EmployeePayUpdate) =>
    request<unknown>(base(schoolId), { method: 'PATCH', body: JSON.stringify(update) }),

  listRuns: (schoolId: string) => request<PayrollRun[]>(`${base(schoolId)}/runs`),

  generate: (schoolId: string, period_year: number, period_month: number) =>
    request<{ payroll_run_id: number; was_rerun: boolean; employee_count: number; total_gross: number; expense_id: number }>(`${base(schoolId)}/runs`, {
      method: 'POST',
      body: JSON.stringify({ period_year, period_month }),
    }),

  downloadPayslips: (schoolId: string, runId: number, year: number, month: number) =>
    downloadFileFrom(`${base(schoolId)}/runs/${runId}`, `payslips-${year}-${String(month).padStart(2, '0')}.pdf`),
};
