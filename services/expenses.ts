import type { Expense } from '@/types/reference-data';
import { request } from './http';
import { datedPdfName, downloadPdfFrom } from './pdf';
import { referenceResource } from './reference-data';
import { DEFAULT_PAGE_SIZE, type Page } from '@/types/pagination';

export const expensesApi = {
  ...referenceResource<Expense, { expense_category_id: string; amount: number; expense_date: string; description: string }>('expenses'),
  /** One page, newest first; the first page also carries totals over every expense. */
  listPage: (schoolId: string, cursor: string | null = null) =>
    request<Page<Expense>>(
      `/api/schools/${schoolId}/expenses?limit=${DEFAULT_PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),
  downloadPdf: (schoolId: string) =>
    downloadPdfFrom(`/api/schools/${schoolId}/expenses?format=pdf`, datedPdfName('expenses')),
  remove: (schoolId: string, expenseId: number) =>
    request<Expense>(`/api/schools/${schoolId}/expenses?expense_id=${encodeURIComponent(expenseId)}`, { method: 'DELETE' }),
};
