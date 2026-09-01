import type { ReactNode } from 'react';

export function SectionHeading({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail?: string; action?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[.2em] text-primary">{eyebrow}</p>
        <h1 className="serif text-3xl font-semibold tracking-[-.03em] text-foreground md:text-[38px]">{title}</h1>
        {detail && <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{detail}</p>}
      </div>
      {action}
    </div>
  );
}
