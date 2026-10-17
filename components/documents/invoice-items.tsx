'use client';

import { formatCurrency } from '../../lib/currency';
import type { IncomeCategory, PaymentPeriod } from '../../types/reference-data';

/** One invoice line as edited on screen — strings, since they come straight from inputs. */
export type InvoiceItemDraft = {
  income_category_id: number;
  payment_period_id: string;
  amount: string;
};

/** A fee's configured limit, or '' when none is set. */
function defaultAmount(category: IncomeCategory | undefined): string {
  const limit = category?.income_limit;
  return limit === null || limit === undefined || limit === '' ? '' : String(Number(limit));
}

export function invoiceTotal(items: InvoiceItemDraft[]): number {
  return items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
}

/**
 * Picks the income streams that go on an invoice. Ticking one adds a line at
 * that fee's default limit; the amount can then be changed for this invoice
 * alone (the fee's own limit is not touched), and set back with "Use default".
 *
 * What the server stores is recomputed from these ids and amounts — names and
 * the total are looked up there, not taken from this screen.
 */
export function InvoiceItems({
  incomeCategories,
  paymentPeriods,
  items,
  onChange,
}: {
  incomeCategories: IncomeCategory[];
  paymentPeriods: PaymentPeriod[];
  items: InvoiceItemDraft[];
  onChange: (items: InvoiceItemDraft[]) => void;
}) {
  // pg returns BIGINT ids as strings, so every comparison goes through Number().
  const categoryById = new Map(incomeCategories.map((category) => [Number(category.income_category_id), category]));
  const isSelected = (id: number) => items.some((item) => item.income_category_id === id);

  const toggle = (category: IncomeCategory) => {
    const id = Number(category.income_category_id);
    if (isSelected(id)) {
      onChange(items.filter((item) => item.income_category_id !== id));
    } else {
      onChange([...items, { income_category_id: id, payment_period_id: '', amount: defaultAmount(category) }]);
    }
  };

  const update = (id: number, patch: Partial<InvoiceItemDraft>) =>
    onChange(items.map((item) => (item.income_category_id === id ? { ...item, ...patch } : item)));

  return (
    <div className="mt-4 rounded-lg border border-border/70 bg-secondary/20 p-4" data-testid="panel-invoice-items">
      <p className="text-[11px] font-semibold text-muted-foreground">Income streams on this invoice</p>

      {incomeCategories.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">No income streams yet — add them in School setup first.</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {incomeCategories.map((category) => {
            const id = Number(category.income_category_id);
            const selected = isSelected(id);
            return (
              <label
                key={id}
                className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] ${selected ? 'border-primary bg-primary/10 font-semibold text-foreground' : 'border-border bg-background text-muted-foreground hover:border-primary/50'}`}
              >
                <input type="checkbox" checked={selected} onChange={() => toggle(category)} className="h-3 w-3" data-testid={`checkbox-invoice-income-${id}`} />
                {category.income_name}
              </label>
            );
          })}
        </div>
      )}

      {items.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="py-1 font-semibold">Item</th>
                <th className="py-1 font-semibold">Period (optional)</th>
                <th className="py-1 font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {items.map((item) => {
                const category = categoryById.get(item.income_category_id);
                const fallback = defaultAmount(category);
                return (
                  <tr key={item.income_category_id}>
                    <td className="py-1.5 pr-2 font-medium">{category?.income_name ?? 'Unknown income stream'}</td>
                    <td className="py-1.5 pr-2">
                      <select
                        value={item.payment_period_id}
                        onChange={(e) => update(item.income_category_id, { payment_period_id: e.target.value })}
                        className="field h-8 text-[11px]"
                        data-testid={`select-invoice-period-${item.income_category_id}`}
                      >
                        <option value="">—</option>
                        {paymentPeriods.map((period) => (
                          <option key={period.payment_period_id} value={period.payment_period_id}>{period.period_name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1.5">
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        required
                        value={item.amount}
                        onChange={(e) => update(item.income_category_id, { amount: e.target.value })}
                        placeholder="Amount"
                        className="field h-8 w-28 text-[11px]"
                        data-testid={`input-invoice-amount-${item.income_category_id}`}
                      />
                      <span className="ml-2 text-[10px] text-muted-foreground">
                        {fallback === '' ? (
                          'No default limit'
                        ) : item.amount === fallback ? (
                          'Default'
                        ) : (
                          <button type="button" onClick={() => update(item.income_category_id, { amount: fallback })} className="underline hover:text-foreground">
                            Use default ({formatCurrency(fallback)})
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <td className="py-1.5" colSpan={2}>TOTAL DUE</td>
                <td className="py-1.5" data-testid="text-invoice-total">{formatCurrency(invoiceTotal(items))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="mt-2 text-[10px] text-muted-foreground">
        Changing an amount here affects this invoice only — the fee&rsquo;s default limit stays as it is in School setup.
      </p>
    </div>
  );
}
