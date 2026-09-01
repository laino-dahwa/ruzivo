'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useToast } from '../../app/components/hooks/use-toast';
import { useCurrentSchoolId } from '../../lib/client/current-school-id';
import { formatCurrency } from '../../lib/currency';
import { expensesApi } from '../../services/expenses';
import type { Expense } from '../../types/reference-data';
import { useSchoolReferenceData } from '../reference-data/use-school-reference-data';
import { SectionHeading } from '../shared/section-heading';
import { NoSchoolNotice } from '../shared/no-school-notice';
import { ErrorNotice } from '../shared/error-notice';
import { ConfirmDialog } from '../shared/confirm-dialog';

export function ExpensesView() {
  const { schoolId } = useCurrentSchoolId();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const ref = useSchoolReferenceData(schoolId);
  const [form, setForm] = useState({ expense_category_id: '', amount: '', expense_date: '', description: '' });
  const [pendingDeleteExpense, setPendingDeleteExpense] = useState<Expense | null>(null);

  const expensesQuery = useQuery({ queryKey: ['expenses', schoolId], queryFn: () => expensesApi.list(schoolId!), enabled: !!schoolId });

  const categoryName = (id: number) => ref.expenseCategories.data?.find((c) => c.expense_category_id === id)?.expense_name ?? '—';

  const createExpense = useMutation({
    mutationFn: () => expensesApi.create(schoolId!, [{ expense_category_id: form.expense_category_id, amount: Number(form.amount), expense_date: form.expense_date, description: form.description }]),
    onSuccess: () => {
      toast({ title: 'Expense logged' });
      setForm({ expense_category_id: '', amount: '', expense_date: '', description: '' });
      queryClient.invalidateQueries({ queryKey: ['expenses', schoolId] });
    },
    onError: (error) => toast({ title: 'Could not log expense', description: (error as Error).message, variant: 'destructive' }),
  });

  const deleteExpense = useMutation({
    mutationFn: (expenseId: number) => expensesApi.remove(schoolId!, expenseId),
    onSuccess: () => {
      toast({ title: 'Expense deleted' });
      setPendingDeleteExpense(null);
      queryClient.invalidateQueries({ queryKey: ['expenses', schoolId] });
    },
    onError: (error) => toast({ title: 'Could not delete expense', description: (error as Error).message, variant: 'destructive' }),
  });

  return (
    <>
      <SectionHeading eyebrow="Expenses" title="Expenses" detail="Backed by GET/POST /api/schools/[school_id]/expenses." />
      {!schoolId ? <NoSchoolNotice /> : (
        <>
          <div className="rounded-2xl border border-border/80 bg-card p-5">
            <h3 className="text-sm font-semibold">Log an expense</h3>
            <form onSubmit={(event) => { event.preventDefault(); createExpense.mutate(); }} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <select required value={form.expense_category_id} onChange={(e) => setForm((f) => ({ ...f, expense_category_id: e.target.value }))} className="field">
                <option value="">Category…</option>
                {ref.expenseCategories.data?.map((c) => <option key={c.expense_category_id} value={c.expense_category_id}>{c.expense_name}</option>)}
              </select>
              <input required type="number" min="1" placeholder="Amount" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className="field" />
              <input required type="date" value={form.expense_date} onChange={(e) => setForm((f) => ({ ...f, expense_date: e.target.value }))} className="field" />
              <input required placeholder="Description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="field" />
              <button type="submit" disabled={createExpense.isPending} className="button-lift flex h-10 items-center justify-center gap-2 rounded-lg bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-60 sm:col-span-2 lg:col-span-4"><Plus size={15} />{createExpense.isPending ? 'Saving…' : 'Log expense'}</button>
            </form>
            <ErrorNotice error={createExpense.error} />
          </div>

          <div className="mt-6 overflow-x-auto rounded-2xl border border-border/80 bg-card p-5">
            <table className="w-full text-left text-xs">
              <thead className="bg-secondary/60 text-[10px] uppercase text-muted-foreground">
                <tr><th className="px-3 py-2 font-semibold">Date</th><th className="px-3 py-2 font-semibold">Category</th><th className="px-3 py-2 font-semibold">Description</th><th className="px-3 py-2 font-semibold">Amount</th><th className="px-3 py-2 font-semibold"></th></tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {expensesQuery.isLoading && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={5}>Loading…</td></tr>}
                {!expensesQuery.isLoading && (expensesQuery.data?.length ?? 0) === 0 && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={5}>No expenses found</td></tr>}
                {expensesQuery.data?.map((expense) => (
                  <tr key={expense.expense_id}>
                    <td className="px-3 py-2">{expense.expense_date ? new Date(expense.expense_date).toLocaleDateString('en-GB') : ''}</td>
                    <td className="px-3 py-2">{categoryName(expense.expense_category_id)}</td>
                    <td className="px-3 py-2">{expense.description}</td>
                    <td className="px-3 py-2 font-semibold">{formatCurrency(expense.amount)}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        title="Delete this expense"
                        disabled={deleteExpense.isPending}
                        onClick={() => setPendingDeleteExpense(expense)}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ErrorNotice error={expensesQuery.error} />
          </div>
        </>
      )}
      <ConfirmDialog
        open={!!pendingDeleteExpense}
        title="Delete this expense?"
        description={pendingDeleteExpense ? `The ${categoryName(pendingDeleteExpense.expense_category_id)} expense of ${formatCurrency(pendingDeleteExpense.amount)} will be removed.` : undefined}
        pending={deleteExpense.isPending}
        onCancel={() => setPendingDeleteExpense(null)}
        onConfirm={() => { if (pendingDeleteExpense) deleteExpense.mutate(pendingDeleteExpense.expense_id); }}
      />
    </>
  );
}
