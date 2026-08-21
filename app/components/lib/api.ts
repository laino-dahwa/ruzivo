// Typed fetch client for the existing /api routes (repositories/api are not modified).

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      message = body?.error ?? message;
    } catch {
      // ignore parse failure, keep default message
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function qs(params: Record<string, string | null | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => search.set(key, value && value.length > 0 ? value : 'null'));
  return search.toString();
}

// ---------- Schools ----------
export type School = {
  school_id: string;
  school_name: string;
  school_type: string;
  school_address: string;
  school_contact: string;
  school_email: string;
};

export const schoolsApi = {
  create: (schools: School[]) =>
    request<School[]>('/api/schools', { method: 'POST', body: JSON.stringify(schools) }),
  get: (schoolId: string) => request<School[]>(`/api/schools/${schoolId}`),
  update: (schoolId: string, schools: (Partial<School> & { school_id: string })[]) =>
    request<School[]>(`/api/schools/${schoolId}`, { method: 'PATCH', body: JSON.stringify(schools) }),
  remove: (schoolId: string) => request<School>(`/api/schools?school_id=${encodeURIComponent(schoolId)}`, { method: 'DELETE' }),
};

// ---------- School reference data ----------
export type ClassCategory = { class_category_id: number; school_id: string; class_name: string };
export type Gender = { gender_id: number; school_id: string; gender_name: string };
export type AcademicYear = { academic_year_id: number; school_id: string; academic_year_name: string; start_date: string; end_date: string };
export type PaymentPeriod = { payment_period_id: number; school_id: string; period_name: string };
export type PaymentMethod = { payment_method_id: number; school_id: string; method_name: string };
export type IncomeCategory = { income_category_id: number; school_id: string; income_name: string; income_limit: string };
export type ExpenseCategory = { expense_category_id: number; school_id: string; expense_name: string };
export type Expense = { expense_id: number; expense_category_id: number; amount: number; expense_date: string; description: string };

function referenceResource<TRow, TCreate>(segment: string) {
  return {
    list: (schoolId: string) => request<TRow[]>(`/api/schools/${schoolId}/${segment}`),
    create: (schoolId: string, rows: TCreate[]) =>
      request<TRow[]>(`/api/schools/${schoolId}/${segment}`, { method: 'POST', body: JSON.stringify(rows) }),
  };
}

export const classCategoriesApi = referenceResource<ClassCategory, { school_id: string; class_name: string }>('class_categories');
export const gendersApi = referenceResource<Gender, { school_id: string; gender_name: string }>('gender');
export const academicYearsApi = referenceResource<AcademicYear, { school_id: string; academic_year_name: string; start_date: string; end_date: string }>('academic_years');
export const paymentPeriodsApi = referenceResource<PaymentPeriod, { school_id: string; period_name: string }>('payment_periods');
export const paymentMethodsApi = referenceResource<PaymentMethod, { school_id: string; method_name: string }>('payment_methods');
export const incomeCategoriesApi = referenceResource<IncomeCategory, { school_id: string; income_name: string; income_limit: string }>('income_categories');
export const expenseCategoriesApi = referenceResource<ExpenseCategory, { school_id: string; expense_name: string }>('expense_categories');
export const expensesApi = referenceResource<Expense, { expense_category_id: string; amount: number; expense_date: string; description: string }>('expenses');

// ---------- Learners ----------
export type Learner = {
  learner_id: string;
  first_name: string;
  last_name: string;
  gender_name: string;
  curent_year: string;
  class_name: string;
};

export type CreateLearnerInput = {
  school_id: string;
  first_name: string;
  last_name: string;
  gender_id: number;
  date_of_birth: string;
  class_category_id: number;
  academic_year_id: number;
};

export type UpdateLearnerInput = {
  learner_id: string;
  enrolment_id: number;
  first_name?: string;
  last_name?: string;
  gender_id?: number;
  date_of_birth?: string;
  class_category_id?: number;
  academic_year_id?: number;
};

export type LearnerFilters = {
  learner_id?: string | null;
  class_name?: string | null;
  gender_name?: string | null;
  academic_year?: string | null;
};

export const learnersApi = {
  list: (filters: LearnerFilters = {}) =>
    request<Learner[]>(`/api/learners?${qs({
      learner_id: filters.learner_id,
      class_name: filters.class_name,
      gender_name: filters.gender_name,
      academic_year: filters.academic_year,
    })}`),
  create: (learners: CreateLearnerInput[]) => request<(CreateLearnerInput & { learner_id: string })[]>('/api/learners', { method: 'POST', body: JSON.stringify(learners) }),
  update: (learners: UpdateLearnerInput[]) => request<unknown>('/api/learners', { method: 'PATCH', body: JSON.stringify(learners) }),
};

// ---------- Payments & balances ----------
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

export type CreateChargesWithPaymentsInput = {
  learner_id: string;
  enrolment_id: number;
  payment_period_id: number;
  academic_year_id: number;
  payment_method_id: number;
  income_categories: { income_category_id: number; amount: number }[];
};

export const paymentsApi = {
  list: (filters: PaymentFilters = {}) =>
    request<Payment[]>(`/api/learners/payments?${qs({
      learner_id: filters.learner_id,
      class_name: filters.class_name,
      gender_name: filters.gender_name,
      academic_year: filters.academic_year,
      income_name: filters.income_name,
      payment_period: filters.payment_period,
      method_name: filters.method_name,
    })}`),
  create: (input: CreateChargesWithPaymentsInput) =>
    request<unknown>('/api/learners/payments', { method: 'POST', body: JSON.stringify(input) }),
  deleteCharge: (chargeId: number) =>
    request<unknown>(`/api/learners/payments?charge_id=${encodeURIComponent(String(chargeId))}`, { method: 'DELETE' }),
};

export const balancesApi = {
  list: (filters: Omit<PaymentFilters, 'method_name'> = {}) =>
    request<Balance[]>(`/api/learners/balances?${qs({
      learner_id: filters.learner_id,
      class_name: filters.class_name,
      gender_name: filters.gender_name,
      academic_year: filters.academic_year,
      income_name: filters.income_name,
      payment_period: filters.payment_period,
    })}`),
};
