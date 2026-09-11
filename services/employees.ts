import { request } from './http';
import type { CreateEmployeeInput, Employee, CreatedEmployee } from '@/types/employee';

export const employeesApi = {
  list: (schoolId: string) => request<Employee[]>(`/api/schools/${schoolId}/employees`),
  create: (schoolId: string, rows: CreateEmployeeInput[]) =>
    request<CreatedEmployee[]>(`/api/schools/${schoolId}/employees`, { method: 'POST', body: JSON.stringify(rows) }),
  remove: (schoolId: string, employeeId: number) =>
    request<Employee>(`/api/schools/${schoolId}/employees?employee_id=${encodeURIComponent(String(employeeId))}`, { method: 'DELETE' }),
};
