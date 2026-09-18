'use client';

import { formatCurrency } from '../../lib/currency';

/**
 * How much of what was due has actually come in.
 *
 * A single ratio against a limit, so this is a meter rather than a two-slice
 * pie — the number is the point, and the bar just gives it a shape. The track
 * is the same neutral the card sits on, so the filled portion is the only
 * thing carrying a value.
 *
 * Both amounts are printed beneath: the percentage alone would leave a reader
 * unable to tell $340 of $500 from $34,000 of $50,000.
 */
export function CollectionMeter({ collected, outstanding }: { collected: number; outstanding: number }) {
  const due = collected + outstanding;
  const rate = due > 0 ? collected / due : 0;
  const percent = Math.round(rate * 100);

  return (
    <div className="rounded-2xl border border-border/80 bg-card p-5" data-testid="card-collection-rate">
      <h3 className="text-sm font-semibold">Fee collection</h3>
      <p className="mt-1 text-[11px] text-muted-foreground">Of everything charged in this window, how much has been paid.</p>

      {due === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-border bg-secondary/30 px-3 py-6 text-center text-xs text-muted-foreground">
          Nothing has been charged in this window yet.
        </p>
      ) : (
        <>
          {/* Proportional figures, not tabular: equal-width digits make a large
              standalone number look loose. */}
          <p className="mt-5 text-5xl font-semibold leading-none tracking-[-.045em]" data-testid="text-collection-rate">
            {percent}<span className="text-2xl text-muted-foreground">%</span>
          </p>

          <div
            className="mt-5 h-2.5 w-full overflow-hidden rounded-full bg-secondary"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={`${percent}% collected — ${formatCurrency(collected)} of ${formatCurrency(due)}`}
            aria-label="Fee collection rate"
          >
            <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${Math.min(100, Math.max(0, rate * 100))}%` }} />
          </div>

          <div className="mt-4 flex items-start justify-between gap-4">
            <div>
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-primary" />Collected
              </span>
              <p className="mt-0.5 text-sm font-semibold">{formatCurrency(collected)}</p>
            </div>
            <div className="text-right">
              <span className="flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-secondary ring-1 ring-border" />Still due
              </span>
              <p className="mt-0.5 text-sm font-semibold">{formatCurrency(outstanding)}</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
