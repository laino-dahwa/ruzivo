export type ClassCategory = { class_category_id: number; school_id: string; class_name: string };
export type Gender = { gender_id: number; school_id: string; gender_name: string };
export type AcademicYear = { academic_year_id: number; school_id: string; academic_year_name: string; start_date: string; end_date: string };
export type PaymentPeriod = { payment_period_id: number; school_id: string; period_name: string };
export type PaymentMethod = { payment_method_id: number; school_id: string; method_name: string };
export type IncomeCategoryPriority = 'MANDATORY' | 'OPTIONAL';
export type ClassApplicability = 'ALL_LEARNERS' | 'SPECIFIC_CLASSES' | 'SPECIFIC_LEARNERS';
export type PeriodApplicability = 'ALL_PERIODS' | 'SPECIFIC_PERIODS';

export type IncomeCategory = {
  income_category_id: number;
  school_id: string;
  income_name: string;
  income_limit: string;
  priority: IncomeCategoryPriority;
  class_applicability: ClassApplicability;
  period_applicability: PeriodApplicability;
  class_category_ids: number[];
  learner_ids: string[];
  payment_period_ids: number[];
};
export type ExpenseCategory = { expense_category_id: number; school_id: string; expense_name: string };
export type Expense = { expense_id: number; expense_category_id: number; amount: number; expense_date: string; description: string };
export type Role = { role_id: number; school_id: string; role_name: string };
