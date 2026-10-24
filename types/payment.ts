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
  payment_id: number;
  paid_at: string;
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

/** One {charge, payment, allocation} triple, as returned by POST /api/learners/payments — see repositories/payment/create/createNewPayment.ts. */
export type CreatedChargeWithPayment = {
  charge: {
    charge_id: number;
    learner_id: string;
    enrolment_id: number;
    income_category_id: number;
    payment_period_id: number;
    academic_year_id: number;
    created_at: string;
  };
  payment: {
    payment_id: number;
    amount: string;
    payment_method_id: number;
    paid_at: string;
  };
  allocation: {
    allocation_id: number;
    payment_id: number;
    charge_id: number;
  };
};

export type ObligationStatus = 'NO_PAYMENT' | 'PARTIALLY_PAID' | 'FULLY_PAID';

/** One row from GET /api/schools/:school_id/obligations — see repositories/payment/read/getObligations.ts. */
export type ObligationRow = {
  learner_id: string;
  first_name: string;
  last_name: string;
  class_name: string;
  income_name: string;
  /** ONCE_OFF rows appear only once something has been paid toward the fee. */
  priority: 'MANDATORY' | 'OPTIONAL' | 'ONCE_OFF';
  period_name: string;
  academic_year_name: string;
  expected: string | null;
  paid: string;
  balance: string | null;
  status: ObligationStatus | null;
};

export type ObligationFilters = {
  class_category_id?: number | null;
  learner_id?: string | null;
  income_category_id?: number | null;
  priority?: 'MANDATORY' | 'OPTIONAL' | 'ONCE_OFF' | null;
  status?: ObligationStatus | null;
  academic_year_id?: number | null;
  payment_period_id?: number | null;
};
