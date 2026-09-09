import type { Expense } from '@/types/reference-data';
import { request } from './http';
import { datedPdfName, downloadPdfFrom } from './pdf';
import { referenceResource } from './reference-data';

export const expensesApi = {
  ...referenceResource<Expense, { expense_category_id: string; amount: number; expense_date: string; description: string }>('expenses'),
  downloadPdf: (schoolId: string) =>
    downloadPdfFrom(`/api/schools/${schoolId}/expenses?format=pdf`, datedPdfName('expenses')),
  remove: (schoolId: string, expenseId: number) =>
    request<Expense>(`/api/schools/${schoolId}/expenses?expense_id=${encodeURIComponent(expenseId)}`, { method: 'DELETE' }),
};
