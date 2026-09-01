import type { School } from '@/types/school';
import { request } from './http';

export const schoolsApi = {
  create: (schools: School[]) =>
    request<School[]>('/api/schools', { method: 'POST', body: JSON.stringify(schools) }),
  get: (schoolId: string) => request<School[]>(`/api/schools/${schoolId}`),
  update: (schoolId: string, schools: (Partial<School> & { school_id: string })[]) =>
    request<School[]>(`/api/schools/${schoolId}`, { method: 'PATCH', body: JSON.stringify(schools) }),
  remove: (schoolId: string) => request<School>(`/api/schools?school_id=${encodeURIComponent(schoolId)}`, { method: 'DELETE' }),
};
