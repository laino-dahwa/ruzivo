import { query } from "../db";
import { formatCurrency } from "../currency";
import type { InvoiceData } from "./renderDocumentPdf";

/** One line as the Documents page sends it: which fee, optionally which period, and how much. */
export type InvoiceLineInput = {
  income_category_id: number;
  payment_period_id: number | null;
  amount: number;
};

export class InvoiceInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceInputError";
  }
}

const MAX_LINES = 50;
const MAX_AMOUNT = 1_000_000_000;

/** Validates the shape of the request body's `invoice_lines`, before anything touches the database. */
export function parseInvoiceLines(raw: unknown): InvoiceLineInput[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new InvoiceInputError("Add at least one income stream to the invoice.");
  }
  if (raw.length > MAX_LINES) {
    throw new InvoiceInputError(`An invoice can have at most ${MAX_LINES} items.`);
  }

  return raw.map((line, index) => {
    const position = `Item ${index + 1}`;
    const income_category_id = Number(line?.income_category_id);
    if (!Number.isInteger(income_category_id) || income_category_id < 1) {
      throw new InvoiceInputError(`${position}: choose an income stream.`);
    }

    const rawPeriod = line?.payment_period_id;
    const payment_period_id = rawPeriod === null || rawPeriod === undefined || rawPeriod === "" ? null : Number(rawPeriod);
    if (payment_period_id !== null && (!Number.isInteger(payment_period_id) || payment_period_id < 1)) {
      throw new InvoiceInputError(`${position}: unknown payment period.`);
    }

    const amount = Number(line?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new InvoiceInputError(`${position}: enter an amount greater than zero.`);
    }
    if (amount > MAX_AMOUNT) {
      throw new InvoiceInputError(`${position}: that amount is too large.`);
    }

    // Cents, rounded once here, so the total below is exact.
    return { income_category_id, payment_period_id, amount: Math.round(amount * 100) / 100 };
  });
}

/**
 * Builds the invoice exactly as it will be printed and stored.
 *
 * The amounts are the user's — editing a fee's default limit for one invoice
 * is the point — but the fee and period *names* are looked up here from the
 * school's own records, and the total is computed here. An income stream or
 * period that belongs to another school is refused rather than printed.
 */
export async function buildInvoice(school_id: string, lines: InvoiceLineInput[]): Promise<InvoiceData> {
  const incomeIds = [...new Set(lines.map((line) => line.income_category_id))];
  const periodIds = [...new Set(lines.flatMap((line) => (line.payment_period_id === null ? [] : [line.payment_period_id])))];

  const [incomes, periods] = await Promise.all([
    query(
      `SELECT income_category_id::int AS id, income_name FROM income_categories WHERE school_id = $1 AND income_category_id = ANY($2::bigint[])`,
      [school_id, incomeIds]
    ),
    periodIds.length === 0
      ? Promise.resolve({ rows: [] as { id: number; period_name: string }[] })
      : query(
          `SELECT payment_period_id::int AS id, period_name FROM payment_periods WHERE school_id = $1 AND payment_period_id = ANY($2::bigint[])`,
          [school_id, periodIds]
        ),
  ]);

  const incomeName = new Map(incomes.rows.map((row) => [Number(row.id), String(row.income_name)]));
  const periodName = new Map(periods.rows.map((row) => [Number(row.id), String(row.period_name)]));

  let totalCents = 0;
  const built = lines.map((line, index) => {
    const name = incomeName.get(line.income_category_id);
    if (name === undefined) {
      throw new InvoiceInputError(`Item ${index + 1}: that income stream does not belong to this school.`);
    }
    let period = "";
    if (line.payment_period_id !== null) {
      const found = periodName.get(line.payment_period_id);
      if (found === undefined) {
        throw new InvoiceInputError(`Item ${index + 1}: that payment period does not belong to this school.`);
      }
      period = found;
    }
    totalCents += Math.round(line.amount * 100);
    return {
      income_category_id: line.income_category_id,
      income_name: name,
      payment_period_id: line.payment_period_id,
      period_name: period,
      amount: line.amount.toFixed(2),
      amount_label: formatCurrency(line.amount),
    };
  });

  const total = totalCents / 100;
  return { lines: built, total: total.toFixed(2), totalLabel: formatCurrency(total) };
}
