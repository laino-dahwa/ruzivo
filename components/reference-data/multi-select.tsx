'use client';

// A small checkbox-list for picking zero or more options from a short,
// already-fetched list (classes, payment periods, …). No equivalent existed
// anywhere in the app — every existing filter/field is single-value.

export type MultiSelectOption = { value: string; label: string };

export function MultiSelect({
  options,
  value,
  onChange,
  emptyMessage = 'Nothing to choose from yet.',
}: {
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  emptyMessage?: string;
}) {
  const toggle = (optionValue: string) => {
    onChange(
      value.includes(optionValue)
        ? value.filter((v) => v !== optionValue)
        : [...value, optionValue],
    );
  };

  if (options.length === 0) {
    return <p className="text-[11px] text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-border/60 p-2">
      {options.map((option) => (
        <label key={option.value} className="flex items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-secondary">
          <input
            type="checkbox"
            checked={value.includes(option.value)}
            onChange={() => toggle(option.value)}
            className="h-3.5 w-3.5 accent-primary"
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
