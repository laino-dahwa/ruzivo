import type { ExpenseReportRow, OwingReportRow, PaymentReportRow, ReportDate, ReportSummary, ReportType } from '@/types/report';
import { request } from './http';
import { downloadPdfFrom } from './pdf';

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
  downloadPdf: (schoolId: string, type: ReportType, date: ReportDate) =>
    downloadPdfFrom(
      `/api/schools/${schoolId}/reports/${type}?${reportDateParam(date)}&format=pdf`,
      `${type}-report-${date ?? 'all-dates'}.pdf`,
    ),
};
