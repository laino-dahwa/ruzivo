import { request } from './http';
import type { CreateEmployeeInput, Employee, CreatedEmployee, ResetEmployeePassword } from '@/types/employee';

export const employeesApi = {
  list: (schoolId: string) => request<Employee[]>(`/api/schools/${schoolId}/employees`),
  create: (schoolId: string, rows: CreateEmployeeInput[]) =>
    request<CreatedEmployee[]>(`/api/schools/${schoolId}/employees`, { method: 'POST', body: JSON.stringify(rows) }),
  /** Issues a new one-time password (returned once) and ends their sessions. */
  resetPassword: (schoolId: string, employeeId: number) =>
    request<ResetEmployeePassword>(`/api/schools/${schoolId}/employees/${encodeURIComponent(String(employeeId))}/password`, { method: 'POST' }),
  remove: (schoolId: string, employeeId: number) =>
    request<Employee>(`/api/schools/${schoolId}/employees?employee_id=${encodeURIComponent(String(employeeId))}`, { method: 'DELETE' }),
};
