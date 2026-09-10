export type Payment = {
  learner_id: string;
  first_name: string;
  last_name: string;
  gender_name: string;
  class_name: string;
  income_name: string;
  period_name: string;
  academic_year_name: string;
  amount: string;
  method_name: string;
  charge_id: number;
};

export type Balance = {
  learner_id: string;
  first_name: string;
  last_name: string;
  income_name: string;
  charged: string;
  paid: string;
  balance: string;
  period_name: string;
  academic_year_name: string;
};

export type PaymentFilters = {
  learner_id?: string | null;
  class_name?: string | null;
  gender_name?: string | null;
  academic_year?: string | null;
  income_name?: string | null;
  payment_period?: string | null;
  method_name?: string | null;
};

export type BalanceFilters = Omit<PaymentFilters, 'method_name'> & {
  /** Hide rows whose balance is exactly zero. */
  only_outstanding?: boolean;
};

export type CreateChargesWithPaymentsInput = {
  learner_id: string;
  enrolment_id: number;
  payment_period_id: number;
  academic_year_id: number;
  payment_method_id: number;
  income_categories: { income_category_id: number; amount: number }[];
};
