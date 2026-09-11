import type { School } from '@/types/school';
import { request } from './http';
import { downloadFileFrom, datedFileName } from './pdf';

export const schoolsApi = {
  create: (schools: School[]) =>
    request<School[]>('/api/schools', { method: 'POST', body: JSON.stringify(schools) }),
  get: (schoolId: string) => request<School[]>(`/api/schools/${schoolId}`),
  update: (schoolId: string, schools: (Partial<School> & { school_id: string })[]) =>
    request<School[]>(`/api/schools/${schoolId}`, { method: 'PATCH', body: JSON.stringify(schools) }),
  remove: (schoolId: string) => request<School>(`/api/schools?school_id=${encodeURIComponent(schoolId)}`, { method: 'DELETE' }),
};

export const schoolExportApi = {
  /** Every table the school has, as one .xlsx with one sheet per table. */
  download: (schoolId: string) =>
    downloadFileFrom(`/api/schools/${schoolId}/export`, datedFileName(`${schoolId}-export`, 'xlsx')),
};
