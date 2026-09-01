'use client';

import { Trash2 } from 'lucide-react';

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Delete',
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onCancel}>
      <div className="w-full max-w-sm rounded-2xl border border-border/80 bg-card p-5 shadow-xl animate-fade" onMouseDown={(event) => event.stopPropagation()}>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="mt-2 text-xs leading-5 text-muted-foreground">{description}</p>}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary">Cancel</button>
          <button type="button" disabled={pending} onClick={onConfirm} className="button-lift flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-xs font-semibold text-destructive-foreground disabled:opacity-60">
            <Trash2 size={13} />{pending ? 'Deleting…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
