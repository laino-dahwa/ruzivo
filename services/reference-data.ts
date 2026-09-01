import type {
  AcademicYear,
  ClassCategory,
  ExpenseCategory,
  Gender,
  IncomeCategory,
  PaymentMethod,
  PaymentPeriod,
} from '@/types/reference-data';
import { request } from './http';

export function referenceResource<TRow, TCreate>(segment: string) {
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
