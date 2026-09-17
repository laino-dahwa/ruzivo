import type { ObligationFilters, ObligationRow } from '@/types/payment';
import { qs, request } from './http';
import { datedPdfName, downloadPdfFrom } from './pdf';

function obligationParams(filters: ObligationFilters) {
  return qs({
    class_category_id: filters.class_category_id != null ? String(filters.class_category_id) : null,
    learner_id: filters.learner_id,
    income_category_id: filters.income_category_id != null ? String(filters.income_category_id) : null,
    priority: filters.priority,
    status: filters.status,
    academic_year_id: filters.academic_year_id != null ? String(filters.academic_year_id) : null,
    payment_period_id: filters.payment_period_id != null ? String(filters.payment_period_id) : null,
  });
}

export const obligationsApi = {
  list: (schoolId: string, filters: ObligationFilters = {}) =>
    request<ObligationRow[]>(`/api/schools/${schoolId}/obligations?${obligationParams(filters)}`),
  downloadPdf: (schoolId: string, filters: ObligationFilters = {}) =>
    downloadPdfFrom(
      `/api/schools/${schoolId}/obligations?${obligationParams(filters)}&format=pdf`,
      datedPdfName('unpaid-mandatory'),
    ),
};
