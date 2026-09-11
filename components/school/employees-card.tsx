'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Trash2, UserPlus } from 'lucide-react';
import { useToast } from '../../app/components/hooks/use-toast';
import { employeesApi } from '../../services/employees';
import type { CreatedEmployee, Employee } from '../../types/employee';
import type { Role } from '../../types/reference-data';
import { ConfirmDialog } from '../shared/confirm-dialog';

/**
 * Add-employee form plus the roster. Only name and role are entered — the
 * login email and a one-time password are generated server-side
 * (repositories/employee/create) and the password is shown here exactly
 * once, since it is never stored in the clear and can't be recovered later.
 *
 * `roles` comes from the Roles reference-data card above this one on the
 * School setup page — roles are managed there, and picked from here.
 */
export function EmployeesCard({ schoolId, roles }: { schoolId: string; roles: Role[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ first_name: '', last_name: '', role_id: '' });
  const [justCreated, setJustCreated] = useState<CreatedEmployee | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Employee | null>(null);

  const employeesQuery = useQuery({
    queryKey: ['employees', schoolId],
    queryFn: () => employeesApi.list(schoolId),
  });

  const create = useMutation({
    mutationFn: () => employeesApi.create(schoolId, [{ school_id: schoolId, first_name: form.first_name, last_name: form.last_name, role_id: Number(form.role_id) }]),
    onSuccess: ([created]) => {
      setJustCreated(created);
      setForm({ first_name: '', last_name: '', role_id: '' });
      toast({ title: 'Employee added', description: `${created.email} is ready to sign in.` });
      queryClient.invalidateQueries({ queryKey: ['employees', schoolId] });
    },
    onError: (error) => toast({ title: 'Could not add employee', description: (error as Error).message, variant: 'destructive' }),
  });

  const remove = useMutation({
    mutationFn: (employeeId: number) => employeesApi.remove(schoolId, employeeId),
    onSuccess: () => {
      toast({ title: 'Employee removed' });
      setPendingDelete(null);
      queryClient.invalidateQueries({ queryKey: ['employees', schoolId] });
    },
    onError: (error) => {
      toast({ title: 'Could not remove employee', description: (error as Error).message, variant: 'destructive' });
      setPendingDelete(null);
    },
  });

  const copyPassword = async () => {
    if (!justCreated) return;
    try {
      await navigator.clipboard.writeText(justCreated.temporary_password);
      toast({ title: 'Password copied' });
    } catch {
      toast({ title: 'Could not copy', description: 'Select and copy it manually instead.', variant: 'destructive' });
    }
  };

  return (
    <div className="rounded-2xl border border-border/80 bg-card p-5 lg:col-span-2">
      <h3 className="text-sm font-semibold">Employees</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Enter a name and pick a role — the login email and a one-time password are generated automatically.
      </p>

      {roles.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">Add a role above first — an employee needs one to be added.</p>
      ) : (
        <form
          onSubmit={(event) => { event.preventDefault(); create.mutate(); }}
          className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]"
        >
          <input required placeholder="First name" value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} className="field" data-testid="input-employee-first-name" />
          <input required placeholder="Last name" value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))} className="field" data-testid="input-employee-last-name" />
          <select required value={form.role_id} onChange={(e) => setForm((f) => ({ ...f, role_id: e.target.value }))} className="field" data-testid="select-employee-role">
            <option value="" disabled>Role</option>
            {roles.map((role) => <option key={role.role_id} value={role.role_id}>{role.role_name}</option>)}
          </select>
          <button type="submit" disabled={create.isPending} className="button-lift flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-60" data-testid="button-add-employee">
            <UserPlus size={15} />{create.isPending ? 'Adding…' : 'Add'}
          </button>
        </form>
      )}

      {justCreated && (
        <div className="mt-4 rounded-lg border border-primary/40 bg-primary/5 p-3 text-xs" data-testid="panel-new-employee-password">
          <p className="font-semibold">{justCreated.first_name} {justCreated.last_name}&rsquo;s temporary password</p>
          <p className="mt-1 text-muted-foreground">Shown once — copy it now and share it with them. They&rsquo;ll be asked to change it on first sign-in.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded-md bg-secondary px-2 py-1 font-mono">{justCreated.email}</code>
            <code className="rounded-md bg-secondary px-2 py-1 font-mono" data-testid="text-temporary-password">{justCreated.temporary_password}</code>
            <button type="button" onClick={copyPassword} className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground" title="Copy password">
              <Copy size={14} />
            </button>
            <button type="button" onClick={() => setJustCreated(null)} className="ml-auto text-[11px] text-muted-foreground hover:text-foreground">Dismiss</button>
          </div>
        </div>
      )}

      <div className="mt-4 overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full text-left text-xs">
          <thead className="bg-secondary/60 text-[10px] uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-semibold">Name</th>
              <th className="px-3 py-2 font-semibold">Role</th>
              <th className="px-3 py-2 font-semibold">Email</th>
              <th className="px-3 py-2 font-semibold"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {employeesQuery.isLoading && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={4}>Loading…</td></tr>}
            {!employeesQuery.isLoading && (employeesQuery.data?.length ?? 0) === 0 && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={4}>No employees yet</td></tr>}
            {employeesQuery.data?.map((employee) => (
              <tr key={employee.employee_id} data-testid={`row-employee-${employee.employee_id}`}>
                <td className="px-3 py-2">{employee.first_name} {employee.last_name}</td>
                <td className="px-3 py-2">{employee.role_name}</td>
                <td className="px-3 py-2 text-muted-foreground">{employee.email}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    title="Remove this employee"
                    onClick={() => setPendingDelete(employee)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    data-testid={`button-delete-employee-${employee.employee_id}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title="Remove this employee?"
        description={pendingDelete ? `${pendingDelete.first_name} ${pendingDelete.last_name} will no longer be able to sign in.` : undefined}
        confirmLabel="Remove"
        pending={remove.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete.employee_id)}
      />
    </div>
  );
}
