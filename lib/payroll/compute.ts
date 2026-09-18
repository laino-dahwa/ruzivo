/**
 * Turning stored pay components into gross and net.
 *
 * Kept in one place and used by the payroll table, the PDF and the tests
 * alike. Gross and net are deliberately NOT stored in the database: a stored
 * total can drift from the components it is supposed to be the sum of, and a
 * payslip whose own figures do not add up is worse than useless.
 */

export type PayComponents = {
  basic_salary: number;
  transport_allowance: number;
  housing_allowance: number;
  paye_deduction: number;
  pension_deduction: number;
};

export type PayBreakdown = PayComponents & {
  grossPay: number;
  totalDeductions: number;
  netPay: number;
};

/** Postgres returns NUMERIC as a string; everything here normalises through this. */
function amount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function payComponentsOf(row: Record<string, unknown>): PayComponents {
  return {
    basic_salary: amount(row.basic_salary),
    transport_allowance: amount(row.transport_allowance),
    housing_allowance: amount(row.housing_allowance),
    paye_deduction: amount(row.paye_deduction),
    pension_deduction: amount(row.pension_deduction),
  };
}

export function computePay(components: PayComponents): PayBreakdown {
  const grossPay = components.basic_salary + components.transport_allowance + components.housing_allowance;
  const totalDeductions = components.paye_deduction + components.pension_deduction;

  return {
    ...components,
    grossPay,
    totalDeductions,
    // Deductions exceeding gross would be a data-entry mistake rather than a
    // negative wage, but it is shown as it is rather than clamped — hiding it
    // would leave somebody's payslip quietly wrong.
    netPay: grossPay - totalDeductions,
  };
}

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function periodLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1] ?? "?"} ${year}`;
}
