'use client';

import { useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';

export type SearchOption = {
  value: string;
  label: string;
  /** Shown right-aligned in the list, e.g. the fee's limit. */
  hint?: string;
};

/**
 * A type-to-filter picker over a fixed list, matching LearnerAutocomplete's
 * look so the two read the same when they sit side by side.
 *
 * Controlled by `value` (the chosen option's `value`). Unlike a <select> this
 * cannot be validated natively, so the caller checks for an empty value on
 * submit.
 */
export function SearchSelect({
  options,
  value,
  onSelect,
  placeholder,
  className,
  testId,
}: {
  options: SearchOption[];
  value: string;
  onSelect: (value: string) => void;
  placeholder?: string;
  className?: string;
  testId?: string;
}) {
  const selected = options.find((option) => option.value === value) ?? null;

  // What has been typed since the box was last focused, or null when nothing
  // has been. Deriving the input from this rather than mirroring the selection
  // into state keeps the box in step when the value changes from outside — a
  // reset after a save, or a row being removed — with no syncing effect.
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const text = draft ?? selected?.label ?? '';

  const matches = useMemo(() => {
    // Until something is typed the whole list is offered, so the control still
    // behaves like the dropdown it replaced.
    const needle = (draft ?? '').trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [options, draft]);

  const choose = (option: SearchOption) => {
    setDraft(null);
    setOpen(false);
    onSelect(option.value);
  };

  // A half-typed query is discarded rather than left looking like a choice.
  const close = () => {
    setDraft(null);
    setOpen(false);
  };

  return (
    <div className={`relative ${className ?? ''}`}>
      <div className="relative">
        <Search size={14} className={`pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-opacity ${text ? 'opacity-0' : 'opacity-100'}`} />
        <input
          ref={inputRef}
          value={text}
          data-testid={testId}
          onChange={(event) => {
            setDraft(event.target.value);
            setOpen(true);
            if (!event.target.value) onSelect('');
          }}
          onFocus={() => {
            setOpen(true);
            inputRef.current?.select();
          }}
          onBlur={() => setTimeout(close, 150)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && open && matches.length > 0) {
              // Enter picks the top match instead of submitting the form.
              event.preventDefault();
              choose(matches[0]);
            }
            if (event.key === 'Escape' && open) {
              // Closes the list only. Marking the key handled keeps the
              // surrounding dialog open, which would otherwise close too.
              event.preventDefault();
              close();
            }
          }}
          placeholder={placeholder}
          className="field"
          style={{ paddingLeft: text ? undefined : '2rem' }}
        />
      </div>
      {open && matches.length > 0 && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-52 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
          {matches.map((option) => (
            <button
              key={option.value}
              type="button"
              onMouseDown={() => choose(option)}
              className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs hover:bg-secondary ${option.value === value ? 'bg-secondary/60' : ''}`}
            >
              <span>{option.label}</span>
              {option.hint && <span className="text-[10px] text-muted-foreground">{option.hint}</span>}
            </button>
          ))}
        </div>
      )}
      {open && matches.length === 0 && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-lg">No match</div>
      )}
    </div>
  );
}
