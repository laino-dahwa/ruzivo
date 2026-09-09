'use client';

import { useState, type FormEvent } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useToast } from '../../app/components/hooks/use-toast';
import { ConfirmDialog } from '../shared/confirm-dialog';

function capitalise(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function ReferenceListForm<TRow extends Record<string, unknown>>({
  title,
  rows,
  isLoading,
  columns,
  onCreate,
  fields,
  idKey,
  itemNoun,
  onUpdate,
  onDelete,
}: {
  title: string;
  rows: TRow[] | undefined;
  isLoading: boolean;
  columns: { key: keyof TRow; label: string }[];
  onCreate: (values: Record<string, string>) => Promise<unknown>;
  fields: { name: string; label: string; type?: string }[];
  /** Column holding the row's id. Required to enable editing/deleting. */
  idKey?: keyof TRow;
  /** Singular wording for messages, e.g. "gender" for the "Genders" card. */
  itemNoun?: string;
  /** Renames a row. The id is never sent as editable. */
  onUpdate?: (id: number, values: Record<string, string>) => Promise<unknown>;
  onDelete?: (id: number) => Promise<unknown>;
}) {
  const { toast } = useToast();
  const noun = itemNoun ?? title.toLowerCase();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [pendingDelete, setPendingDelete] = useState<TRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const canEdit = !!idKey && !!onUpdate;
  const canDelete = !!idKey && !!onDelete;
  const showActions = canEdit || canDelete;

  const idOf = (row: TRow) => Number(row[idKey as keyof TRow]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await onCreate(values);
      setValues({});
      toast({ title: `${capitalise(noun)} added` });
    } catch (error) {
      toast({ title: `Could not add ${noun}`, description: (error as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (row: TRow) => {
    setEditingId(idOf(row));
    // Seed the inputs with the row's current values for the editable fields.
    setEditValues(Object.fromEntries(fields.map((field) => [field.name, String(row[field.name as keyof TRow] ?? '')])));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValues({});
  };

  const saveEdit = async (row: TRow) => {
    setSaving(true);
    try {
      await onUpdate!(idOf(row), editValues);
      toast({ title: `${capitalise(noun)} updated` });
      cancelEdit();
    } catch (error) {
      // Input is kept so the value can be corrected (e.g. a duplicate name).
      toast({ title: `Could not update ${noun}`, description: (error as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await onDelete!(idOf(pendingDelete));
      toast({ title: `${capitalise(noun)} deleted` });
      setPendingDelete(null);
    } catch (error) {
      // The server refuses while records still reference the row, and says
      // how many — surface that rather than a generic failure.
      toast({ title: `Could not delete ${noun}`, description: (error as Error).message, variant: 'destructive' });
      // Closed either way: the dialog cannot succeed on a retry, and leaving
      // it open traps the user behind the overlay.
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border/80 bg-card p-5">
      <h3 className="text-sm font-semibold">{title}</h3>
      <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2">
        {fields.map((field) => (
          <div key={field.name}>
            <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">{field.label}</label>
            <input
              type={field.type ?? 'text'}
              required
              value={values[field.name] ?? ''}
              onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
              className="field h-9 w-40 text-xs"
            />
          </div>
        ))}
        <button type="submit" disabled={saving} className="button-lift flex h-9 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60"><Plus size={13} />Add</button>
      </form>
      <div className="mt-4 max-h-40 overflow-y-auto rounded-lg border border-border/60">
        <table className="w-full text-left text-xs">
          <thead className="bg-secondary/60 text-[10px] uppercase text-muted-foreground">
            <tr>
              {columns.map((col) => <th key={String(col.key)} className="px-3 py-2 font-semibold">{col.label}</th>)}
              {showActions && <th className="px-3 py-2 font-semibold"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {isLoading && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={columns.length + (showActions ? 1 : 0)}>Loading…</td></tr>}
            {!isLoading && (rows?.length ?? 0) === 0 && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={columns.length + (showActions ? 1 : 0)}>No records yet</td></tr>}
            {rows?.map((row, index) => {
              const editing = canEdit && editingId === idOf(row);
              return (
                <tr key={index}>
                  {columns.map((col) => {
                    const editableField = fields.find((field) => field.name === String(col.key));
                    return (
                      <td key={String(col.key)} className="px-3 py-2">
                        {editing && editableField ? (
                          <input
                            type={editableField.type ?? 'text'}
                            value={editValues[editableField.name] ?? ''}
                            onChange={(event) => setEditValues((current) => ({ ...current, [editableField.name]: event.target.value }))}
                            className="field h-7 w-full text-xs"
                          />
                        ) : (
                          String(row[col.key] ?? '')
                        )}
                      </td>
                    );
                  })}
                  {showActions && (
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {editing ? (
                          <>
                            <button type="button" title="Save changes" disabled={saving} onClick={() => saveEdit(row)} className="rounded-md p-1 text-muted-foreground hover:bg-primary/10 hover:text-primary disabled:opacity-50"><Check size={13} /></button>
                            <button type="button" title="Cancel" onClick={cancelEdit} className="rounded-md p-1 text-muted-foreground hover:bg-secondary"><X size={13} /></button>
                          </>
                        ) : (
                          <>
                            {canEdit && <button type="button" title={`Rename this ${noun}`} onClick={() => startEdit(row)} className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"><Pencil size={13} /></button>}
                            {canDelete && <button type="button" title={`Delete this ${noun}`} onClick={() => setPendingDelete(row)} className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 size={13} /></button>}
                          </>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title={`Delete this ${noun}?`}
        description={pendingDelete ? `"${String(pendingDelete[fields[0].name as keyof TRow] ?? '')}" will be removed. Records already using it are protected — the delete is refused if any exist.` : undefined}
        pending={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
