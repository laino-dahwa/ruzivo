import type { Users } from 'lucide-react';

export function MetricCard({ label, value, note, icon: Icon }: { label: string; value: string; note: string; icon: typeof Users }) {
  return (
    <div className="rounded-2xl border border-border/80 bg-card p-5" data-testid={`card-metric-${label.toLowerCase().replaceAll(' ', '-')}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Icon size={16} /></span>
      </div>
      <p className="mt-5 text-2xl font-semibold tracking-[-.045em]">{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>
    </div>
  );
}
