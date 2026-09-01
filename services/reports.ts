import type { ExpenseReportRow, OwingReportRow, PaymentReportRow, ReportDate, ReportSummary, ReportType } from '@/types/report';
import { errorMessageFor, request } from './http';

function reportDateParam(date: ReportDate) {
  return `date=${date ? encodeURIComponent(date) : 'all'}`;
}

export const reportsApi = {
  summary: (schoolId: string, date: ReportDate) =>
    request<ReportSummary>(`/api/schools/${schoolId}/reports/summary?${reportDateParam(date)}`),
  payments: (schoolId: string, date: ReportDate) =>
    request<{ rows: PaymentReportRow[]; total: number }>(`/api/schools/${schoolId}/reports/payments?${reportDateParam(date)}`),
  owing: (schoolId: string, date: ReportDate) =>
    request<{ rows: OwingReportRow[]; total: number }>(`/api/schools/${schoolId}/reports/owing?${reportDateParam(date)}`),
  expenses: (schoolId: string, date: ReportDate) =>
    request<{ rows: ExpenseReportRow[]; total: number }>(`/api/schools/${schoolId}/reports/expenses?${reportDateParam(date)}`),
  downloadPdf: async (schoolId: string, type: ReportType, date: ReportDate) => {
    const response = await fetch(`/api/schools/${schoolId}/reports/${type}?${reportDateParam(date)}&format=pdf`);
    if (!response.ok) throw new Error(await errorMessageFor(response));
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${type}-report-${date ?? 'all-dates'}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};
