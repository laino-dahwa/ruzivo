import type { ReportType } from '../../types/report';

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  payments: 'Payments',
  owing: 'Owing',
  expenses: 'Expenses',
};

export function formatReportDate(value: string) {
  // Values from the reports API are plain 'YYYY-MM-DD' (or 'YYYY-MM-DD HH:MM:SS')
  // strings, deliberately not JS Date objects, so no timezone reinterpretation happens.
  return value.slice(0, 10).split('-').reverse().join('/');
}
