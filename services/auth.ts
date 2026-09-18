// Relative, not "@/lib/…": that alias points at app/components/lib, not the
// root lib/ directory (see tsconfig.json paths).
import type { AccessLevel } from '../lib/auth/permissions';
import { request } from './http';

export type Actor = {
  employee_id: number;
  school_id: string;
  active_school_id: string;
  access_level: AccessLevel;
  first_name: string;
  last_name: string;
  email: string;
  must_change_password: boolean;
};

export type BootstrapAvailability = {
  available: boolean;
  schools: { school_id: string; school_name: string }[];
};

export type NewSchoolInput = {
  school_id: string;
  school_name: string;
  school_type: string;
  school_address: string;
  school_contact: string;
  school_email: string;
};

export const authApi = {
  session: () => request<{ actor: Actor | null; needs_setup: boolean }>('/api/auth/session'),

  login: (email: string, password: string) =>
    request<Actor>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  setupAvailability: () => request<BootstrapAvailability>('/api/auth/bootstrap'),

  bootstrap: (input: { first_name: string; last_name: string; password: string; school_id?: string; new_school?: NewSchoolInput }) =>
    request<{ employee_id: number; school_id: string; email: string }>('/api/auth/bootstrap', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  changePassword: (current_password: string, new_password: string) =>
    request<{ ok: true }>('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ current_password, new_password }),
    }),

  switchSchool: (school_id: string) =>
    request<Actor>('/api/auth/session', { method: 'PATCH', body: JSON.stringify({ school_id }) }),
};
