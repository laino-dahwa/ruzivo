'use client';

import { useEffect, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';

// Matches the widest grid each form uses, so the fields inside keep the
// columns they were designed around.
const WIDTHS = {
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-3xl',
} as const;

/**
 * Modal shell for the "add a record" forms. Built on the same overlay markup as
 * ConfirmDialog rather than a dialog primitive, so the two read the same.
 *
 * The caller owns the form state: this only shows and hides it, which is what
 * lets a dialog closed by accident be reopened with everything still typed in.
 */
export function FormDialog({
  open,
  title,
  description,
  width = 'lg',
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  width?: keyof typeof WIDTHS;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;

      // An open <select> picker takes Escape for itself; closing the dialog on
      // the same keypress would dismiss both at once.
      const active = document.activeElement;
      if (active instanceof HTMLSelectElement) {
        try {
          if (active.matches(':open')) return;
        } catch {
          // :open is not supported everywhere; the picker is a native popup
          // there and never delivers the key to us anyway.
        }
      }
      onClose();
    };

    // The page behind the overlay must not scroll with it.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`my-auto w-full ${WIDTHS[width]} animate-fade rounded-2xl border border-border/80 bg-card shadow-xl`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border/60 p-5 pb-4">
          <div>
            <h3 className="text-sm font-semibold">{title}</h3>
            {description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>}
          </div>
          <button
            type="button"
            title="Close"
            onClick={onClose}
            className="-mr-1 -mt-1 rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
            data-testid="button-close-dialog"
          >
            <X size={15} />
          </button>
        </div>
        {/* A long form (several learners, several payment lines) scrolls inside
            the dialog rather than pushing it past the top of the screen. */}
        <div className="max-h-[calc(100vh-12rem)] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

/** The button that opens one of these dialogs, sitting in the page heading. */
export function AddRecordButton({ label, onClick, testId }: { label: string; onClick: () => void; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="button-lift flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground"
    >
      <Plus size={15} />{label}
    </button>
  );
}
