import Link from 'next/link';
import { Plus } from 'lucide-react';

export function NoSchoolNotice() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
      <p className="text-sm font-semibold">No school selected yet</p>
      <p className="mt-1 text-xs text-muted-foreground">Create or select a school in School setup to load live data from your API.</p>
      <Link href="/school" className="button-lift mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground"><Plus size={15} />Go to School setup</Link>
    </div>
  );
}
