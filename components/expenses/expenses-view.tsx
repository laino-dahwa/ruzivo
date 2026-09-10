'use client';

import { useState, type FormEvent } from 'react';
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
import { DownloadPdfButton } from '../shared/download-pdf-button';
import { AddRecordButton, FormDialog } from '../shared/form-dialog';

type ExpenseRow = { expense_category_id: string; amount: string; expense_date: string; description: string };

function emptyExpenseRow(): ExpenseRow {
  return { expense_category_id: '', amount: '', expense_date: '', description: '' };
}

export function ExpensesView() {
  const { schoolId } = useCurrentSchoolId();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const ref = useSchoolReferenceData(schoolId);
  const [rows, setRows] = useState<ExpenseRow[]>([emptyExpenseRow()]);
  const [pendingDeleteExpense, setPendingDeleteExpense] = useState<Expense | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const expensesQuery = useQuery({ queryKey: ['expenses', schoolId], queryFn: () => expensesApi.list(schoolId!), enabled: !!schoolId });

  const categoryName = (id: number) => ref.expenseCategories.data?.find((c) => c.expense_category_id === id)?.expense_name ?? '—';

  const createExpense = useMutation({
    mutationFn: (inputs: ExpenseRow[]) => expensesApi.create(
      schoolId!,
      inputs.map((row) => ({
        expense_category_id: row.expense_category_id,
        amount: Number(row.amount),
        expense_date: row.expense_date,
        description: row.description,
      })),
    ),
    onSuccess: (_result, inputs) => {
      toast({ title: inputs.length === 1 ? 'Expense logged' : `${inputs.length} expenses logged` });
      setAddOpen(false);
      // Reset only on success — a failed submission keeps every row so the
      // user can fix the problem instead of retyping the whole batch.
      setRows([emptyExpenseRow()]);
      queryClient.invalidateQueries({ queryKey: ['expenses', schoolId] });
    },
    onError: (error) => toast({ title: 'Could not log expenses', description: (error as Error).message, variant: 'destructive' }),
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

  // Shown live in the dialog footer so the batch total is visible before any
  // of it is written. A blank or half-typed amount contributes nothing.
  const totalAmount = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);

  const updateRow = (index: number, patch: Partial<ExpenseRow>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const addRow = () => setRows((current) => [...current, emptyExpenseRow()]);

  const removeRow = (index: number) => setRows((current) => current.filter((_, i) => i !== index));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // All rows go in one request, written by the API in a single statement.
    createExpense.mutate(rows);
  };

  return (
    <>
      <SectionHeading
        eyebrow="Expenses"
        title="Expenses"
        detail="Backed by GET/POST /api/schools/[school_id]/expenses."
        action={schoolId ? <AddRecordButton label="Log expense" onClick={() => setAddOpen(true)} testId="button-open-log-expense" /> : undefined}
      />
      {!schoolId ? <NoSchoolNotice /> : (
        <>
          <FormDialog
            open={addOpen}
            title={rows.length === 1 ? 'Log an expense' : `Log ${rows.length} expenses`}
            onClose={() => setAddOpen(false)}
          >
            <form onSubmit={submit} className="space-y-3">
              {rows.map((row, index) => (
                <div key={index} className="space-y-2">
                  {rows.length > 1 && (
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Expense {index + 1}</span>
                      <button
                        type="button"
                        title="Remove this expense"
                        onClick={() => removeRow(index)}
                        className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <select required value={row.expense_category_id} onChange={(e) => updateRow(index, { expense_category_id: e.target.value })} className="field">
                      <option value="">Category…</option>
                      {ref.expenseCategories.data?.map((c) => <option key={c.expense_category_id} value={c.expense_category_id}>{c.expense_name}</option>)}
                    </select>
                    <input required type="number" min="1" placeholder="Amount" value={row.amount} onChange={(e) => updateRow(index, { amount: e.target.value })} className="field" />
                    <input required type="date" value={row.expense_date} onChange={(e) => updateRow(index, { expense_date: e.target.value })} className="field" />
                    <input required placeholder="Description" value={row.description} onChange={(e) => updateRow(index, { description: e.target.value })} className="field" />
                  </div>
                </div>
              ))}
              <ErrorNotice error={createExpense.error} />
              {/* Pinned to the bottom of the scroll area so the total and the
                  submit button stay reachable however many rows are open. */}
              <div className="sticky bottom-0 -mx-5 border-t border-border/60 bg-card px-5 pb-5 pt-3">
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {rows.length === 1 ? 'Total' : `Total · ${rows.length} expenses`}
                  </span>
                  <span className="text-base font-semibold tabular-nums" data-testid="expenses-total">{formatCurrency(totalAmount)}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <button type="button" onClick={addRow} className="button-lift flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-background text-xs font-semibold text-foreground hover:border-primary/50" data-testid="button-add-expense-row"><Plus size={15} />Add another</button>
                  <button type="submit" disabled={createExpense.isPending} className="button-lift flex h-10 items-center justify-center gap-2 rounded-lg bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-60 sm:col-span-1 lg:col-span-3"><Plus size={15} />{createExpense.isPending ? 'Saving…' : rows.length === 1 ? 'Log expense' : `Log ${rows.length} expenses`}</button>
                </div>
              </div>
            </form>
          </FormDialog>

          <div className="rounded-2xl border border-border/80 bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Logged expenses</h3>
              <DownloadPdfButton
                disabled={expensesQuery.isLoading}
                onDownload={() => expensesApi.downloadPdf(schoolId)}
              />
            </div>
            <div className="overflow-x-auto rounded-lg border border-border/60">
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
            </div>
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
