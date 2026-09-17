import { request } from './http';
import type { IncomeCategory } from '@/types/reference-data';

export type IncomeCategoryInput = {
  school_id: string;
  income_name: string;
  income_limit: string | null;
  priority?: IncomeCategory['priority'];
  class_applicability?: IncomeCategory['class_applicability'];
  period_applicability?: IncomeCategory['period_applicability'];
  class_category_ids?: number[];
  learner_ids?: string[];
  payment_period_ids?: number[];
};

export type UpdateIncomeCategoryInput = IncomeCategoryInput & { income_category_id: number };

// Bespoke rather than services/reference-data.ts's generic referenceResource
// factory: create/update carry applicability membership (which classes,
// learners, periods a fee applies to) that the generic factory's flat
// {school_id, name, value} shape can't express — same reason Employees has
// its own dedicated service.
export const incomeCategoriesApi = {
  list: (schoolId: string) => request<IncomeCategory[]>(`/api/schools/${schoolId}/income_categories`),
  create: (schoolId: string, rows: IncomeCategoryInput[]) =>
    request<IncomeCategory[]>(`/api/schools/${schoolId}/income_categories`, { method: 'POST', body: JSON.stringify(rows) }),
  update: (schoolId: string, rows: UpdateIncomeCategoryInput[]) =>
    request<IncomeCategory[]>(`/api/schools/${schoolId}/income_categories`, { method: 'PATCH', body: JSON.stringify(rows) }),
  remove: (schoolId: string, incomeCategoryId: number) =>
    request<IncomeCategory>(`/api/schools/${schoolId}/income_categories?income_category_id=${encodeURIComponent(String(incomeCategoryId))}`, { method: 'DELETE' }),
};
