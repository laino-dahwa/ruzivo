'use client';

import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { useToast } from '../../app/components/hooks/use-toast';

export function ReferenceListForm<TRow extends Record<string, unknown>>({
  title,
  rows,
  isLoading,
  columns,
  onCreate,
  fields,
}: {
  title: string;
  rows: TRow[] | undefined;
  isLoading: boolean;
  columns: { key: keyof TRow; label: string }[];
  onCreate: (values: Record<string, string>) => Promise<unknown>;
  fields: { name: string; label: string; type?: string }[];
}) {
  const { toast } = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await onCreate(values);
      setValues({});
      toast({ title: `${title} added` });
    } catch (error) {
      toast({ title: `Could not add ${title.toLowerCase()}`, description: (error as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
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
            <tr>{columns.map((col) => <th key={String(col.key)} className="px-3 py-2 font-semibold">{col.label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {isLoading && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={columns.length}>Loading…</td></tr>}
            {!isLoading && (rows?.length ?? 0) === 0 && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={columns.length}>No records yet</td></tr>}
            {rows?.map((row, index) => (
              <tr key={index}>{columns.map((col) => <td key={String(col.key)} className="px-3 py-2">{String(row[col.key] ?? '')}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
