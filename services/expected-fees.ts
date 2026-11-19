import type {
  ExpectedFeeAction,
  ExpectedFeeActionResult,
  ExpectedFeeFilters,
  ExpectedFeeRow,
} from '@/types/expected-fees';
import { qs, request } from './http';
import { datedPdfName, downloadPdfFrom } from './pdf';

function expectedFeeParams(filters: ExpectedFeeFilters) {
  const id = (value: number | null | undefined) => (value != null ? String(value) : null);
  return qs({
    decision: filters.decision ?? null,
    class_category_id: id(filters.class_category_id),
    learner_id: filters.learner_id ?? null,
    income_category_id: id(filters.income_category_id),
    priority: filters.priority ?? null,
    academic_year_id: id(filters.academic_year_id),
    payment_period_id: id(filters.payment_period_id),
  });
}

export const expectedFeesApi = {
  list: (schoolId: string, filters: ExpectedFeeFilters = {}) =>
    request<ExpectedFeeRow[]>(`/api/schools/${schoolId}/expected-fees?${expectedFeeParams(filters)}`),
  downloadPdf: (schoolId: string, filters: ExpectedFeeFilters = {}) =>
    downloadPdfFrom(
      `/api/schools/${schoolId}/expected-fees?${expectedFeeParams(filters)}&format=pdf`,
      datedPdfName('expected-fees'),
    ),
  decide: (schoolId: string, action: ExpectedFeeAction) =>
    request<ExpectedFeeActionResult>(`/api/schools/${schoolId}/expected-fees/decisions`, {
      method: 'POST',
      body: JSON.stringify(action),
    }),
};
