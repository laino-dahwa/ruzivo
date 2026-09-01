export type ReportDate = string | null; // 'YYYY-MM-DD', or null for "All Dates"

export type PaymentReportRow = {
  payment_id: number;
  paid_at_local: string;
  learner_id: string;
  first_name: string;
  last_name: string;
  class_name: string;
  income_name: string;
  method_name: string;
  amount: string;
};

export type OwingReportRow = {
  charge_id: number;
  charge_date: string;
  learner_id: string;
  first_name: string;
  last_name: string;
  class_name: string;
  income_name: string;
  period_name: string;
  academic_year_name: string;
  expected: string;
  paid: string;
  balance: string;
  status: 'Unpaid' | 'Partially Paid';
};

export type ExpenseReportRow = {
  expense_id: number;
  expense_date: string;
  description: string;
  category_name: string;
  amount: string;
};

export type ReportSummary = {
  totalPayments: number;
  totalOutstanding: number;
  totalExpenses: number;
  netPosition: number;
};

export type ReportType = 'payments' | 'owing' | 'expenses';
