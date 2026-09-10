import type { Balance, BalanceFilters, CreateChargesWithPaymentsInput, Payment, PaymentFilters } from '@/types/payment';
import { qs, request } from './http';
import { datedPdfName, downloadPdfFrom } from './pdf';

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
  downloadPdf: (filters: PaymentFilters = {}) =>
    downloadPdfFrom(
      `/api/learners/payments?${qs({
        learner_id: filters.learner_id,
        class_name: filters.class_name,
        gender_name: filters.gender_name,
        academic_year: filters.academic_year,
        income_name: filters.income_name,
        payment_period: filters.payment_period,
        method_name: filters.method_name,
      })}&format=pdf`,
      datedPdfName('payments'),
    ),
  create: (input: CreateChargesWithPaymentsInput | CreateChargesWithPaymentsInput[]) =>
    request<unknown>('/api/learners/payments', { method: 'POST', body: JSON.stringify(input) }),
  deleteCharge: (chargeId: number) =>
    request<unknown>(`/api/learners/payments?charge_id=${encodeURIComponent(String(chargeId))}`, { method: 'DELETE' }),
};

// qs() writes "null" for anything empty, which the API reads back as absent,
// so the flag is only ever sent when it is on.
function balanceParams(filters: BalanceFilters) {
  return qs({
    learner_id: filters.learner_id,
    class_name: filters.class_name,
    gender_name: filters.gender_name,
    academic_year: filters.academic_year,
    income_name: filters.income_name,
    payment_period: filters.payment_period,
    only_outstanding: filters.only_outstanding ? 'true' : undefined,
  });
}

export const balancesApi = {
  list: (filters: BalanceFilters = {}) =>
    request<Balance[]>(`/api/learners/balances?${balanceParams(filters)}`),
  downloadPdf: (filters: BalanceFilters = {}) =>
    downloadPdfFrom(
      `/api/learners/balances?${balanceParams(filters)}&format=pdf`,
      datedPdfName('outstanding-balances'),
    ),
};
