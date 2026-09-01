'use client';

import { useQuery } from '@tanstack/react-query';
import {
  academicYearsApi,
  classCategoriesApi,
  expenseCategoriesApi,
  gendersApi,
  incomeCategoriesApi,
  paymentMethodsApi,
  paymentPeriodsApi,
} from '../../services/reference-data';

export function useSchoolReferenceData(schoolId: string | null) {
  const genders = useQuery({ queryKey: ['genders', schoolId], queryFn: () => gendersApi.list(schoolId!), enabled: !!schoolId });
  const classCategories = useQuery({ queryKey: ['class_categories', schoolId], queryFn: () => classCategoriesApi.list(schoolId!), enabled: !!schoolId });
  const academicYears = useQuery({ queryKey: ['academic_years', schoolId], queryFn: () => academicYearsApi.list(schoolId!), enabled: !!schoolId });
  const paymentPeriods = useQuery({ queryKey: ['payment_periods', schoolId], queryFn: () => paymentPeriodsApi.list(schoolId!), enabled: !!schoolId });
  const paymentMethods = useQuery({ queryKey: ['payment_methods', schoolId], queryFn: () => paymentMethodsApi.list(schoolId!), enabled: !!schoolId });
  const incomeCategories = useQuery({ queryKey: ['income_categories', schoolId], queryFn: () => incomeCategoriesApi.list(schoolId!), enabled: !!schoolId });
  const expenseCategories = useQuery({ queryKey: ['expense_categories', schoolId], queryFn: () => expenseCategoriesApi.list(schoolId!), enabled: !!schoolId });
  return { genders, classCategories, academicYears, paymentPeriods, paymentMethods, incomeCategories, expenseCategories };
}
