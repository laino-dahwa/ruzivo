import type { ExpenseReportRow, OwingReportRow, PaymentReportRow, ReportDate, ReportOverview, ReportSummary, ReportType } from '@/types/report';
import { request } from './http';
import { downloadPdfFrom } from './pdf';

function reportDateParam(date: ReportDate) {
  return `date=${date ? encodeURIComponent(date) : 'all'}`;
}

/**
 * Turns the page's chosen window into query parameters. Only one of the three
 * shapes is ever sent, matching what the API accepts.
 */
export function reportScopeParams(scope: { start?: string | null; end?: string | null; paymentPeriodId?: number | null; academicYearId?: number | null }) {
  const params = new URLSearchParams();
  if (scope.paymentPeriodId) {
    params.set('payment_period_id', String(scope.paymentPeriodId));
    if (scope.academicYearId) params.set('academic_year_id', String(scope.academicYearId));
  } else if (scope.start || scope.end) {
    if (scope.start) params.set('start', scope.start);
    if (scope.end) params.set('end', scope.end);
  } else {
    params.set('date', 'all');
  }
  return params.toString();
}

export const reportsApi = {
  overview: (schoolId: string, scope: Parameters<typeof reportScopeParams>[0]) =>
    request<ReportOverview>(`/api/schools/${schoolId}/reports/overview?${reportScopeParams(scope)}`),
  downloadScopedPdf: (schoolId: string, type: ReportType, scope: Parameters<typeof reportScopeParams>[0], filename: string) =>
    downloadPdfFrom(`/api/schools/${schoolId}/reports/${type}?${reportScopeParams(scope)}&format=pdf`, filename),
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
