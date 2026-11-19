import type { ExemptionKey, ExpectedFeeAction, FeeKey } from "../../types/expected-fees";

/** Enough for "accept every pending fee this year" at a large school, small enough to stay one request. */
export const MAX_ITEMS_PER_ACTION = 20000;
export const MAX_REASON_LENGTH = 500;

type Parsed = { ok: true; action: ExpectedFeeAction } | { ok: false; error: string };

const isId = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0;
const isLearnerId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 8;

function feeKeys(items: unknown[]): FeeKey[] | null {
  const keys: FeeKey[] = [];
  for (const item of items) {
    const { learner_id, income_category_id, payment_period_id, academic_year_id } = (item ?? {}) as Record<string, unknown>;
    if (!isLearnerId(learner_id) || !isId(income_category_id) || !isId(payment_period_id) || !isId(academic_year_id)) return null;
    keys.push({ learner_id, income_category_id, payment_period_id, academic_year_id });
  }
  return keys;
}

function exemptionKeys(items: unknown[]): ExemptionKey[] | null {
  const keys: ExemptionKey[] = [];
  for (const item of items) {
    const { learner_id, income_category_id } = (item ?? {}) as Record<string, unknown>;
    if (!isLearnerId(learner_id) || !isId(income_category_id)) return null;
    keys.push({ learner_id, income_category_id });
  }
  return keys;
}

/** Validates the body of POST /api/schools/:school_id/expected-fees/decisions. */
export function parseExpectedFeeAction(body: unknown): Parsed {
  const { action, items, reason } = (body ?? {}) as Record<string, unknown>;

  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: "Choose at least one fee." };
  }
  if (items.length > MAX_ITEMS_PER_ACTION) {
    return { ok: false, error: `Too many fees in one go (at most ${MAX_ITEMS_PER_ACTION}). Narrow the filters and try again.` };
  }

  switch (action) {
    case "ACCEPT":
    case "SKIP":
    case "UNDO_ACCEPT":
    case "UNDO_SKIP": {
      const keys = feeKeys(items);
      if (!keys) return { ok: false, error: "Each fee needs a learner, fee, period and academic year." };
      return { ok: true, action: { action, items: keys } };
    }
    case "EXEMPT": {
      const keys = exemptionKeys(items);
      if (!keys) return { ok: false, error: "Each fee needs a learner and a fee." };
      const text = typeof reason === "string" ? reason.trim() : "";
      if (!text) return { ok: false, error: "Give a reason for denying this fee forever." };
      if (text.length > MAX_REASON_LENGTH) return { ok: false, error: `Keep the reason under ${MAX_REASON_LENGTH} characters.` };
      return { ok: true, action: { action, items: keys, reason: text } };
    }
    case "RESTORE": {
      const keys = exemptionKeys(items);
      if (!keys) return { ok: false, error: "Each fee needs a learner and a fee." };
      return { ok: true, action: { action, items: keys } };
    }
    default:
      return { ok: false, error: "Unknown action." };
  }
}
