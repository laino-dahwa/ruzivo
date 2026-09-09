// Shared helpers for the bulk (array-of-objects) create endpoints.
//
// Every create endpoint accepts either a single object or an array of them;
// both are normalised to an array here so the repositories — which already
// take arrays and insert them in one statement/transaction — stay unchanged.
//
// Validation runs over the whole batch before anything is written, and the
// endpoints reject the entire batch if any record is invalid (see
// docs/bulk-operations.md for why all-or-nothing is the right call for
// financial records). Errors carry the record's index so the caller can say
// exactly which one failed and why.

export type RecordError = {
  index: number;
  field: string;
  message: string;
};

/** `{...}` -> `[{...}]`, `[{...}]` -> unchanged. Anything else -> null (caller returns 400). */
export function normalizeToArray(body: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(body)) {
    return body.every(isPlainObject) ? (body as Record<string, unknown>[]) : null;
  }
  if (isPlainObject(body)) return [body as Record<string, unknown>];
  return null;
}

function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Builds the 400 body for a failed batch. Keeps the existing `error` key —
 * services/http.ts surfaces that as the thrown message — and adds `details`
 * for per-record reporting, so existing client error handling is unaffected.
 */
export function validationErrorBody(errors: RecordError[], noun: string) {
  const first = errors[0];
  const recordLabel = `${noun} ${first.index + 1}`;
  const summary =
    errors.length === 1
      ? `${recordLabel}: ${first.message}`
      : `${recordLabel}: ${first.message} (and ${errors.length - 1} more problem${errors.length > 2 ? 's' : ''})`;

  return { error: summary, details: errors };
}

// --- field validators -------------------------------------------------
// Each pushes onto `errors` and reports whether the value was usable, so a
// record with several problems reports all of them rather than just the first.

export function requiredText(value: unknown, field: string, index: number, errors: RecordError[]): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push({ index, field, message: `${label(field)} is required` });
  }
}

/** Accepts a number or a numeric string (select inputs submit strings). */
export function positiveId(value: unknown, field: string, index: number, errors: RecordError[]): void {
  const parsed = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    errors.push({ index, field, message: `${label(field)} is required` });
  }
}

export function positiveAmount(value: unknown, field: string, index: number, errors: RecordError[]): void {
  const parsed = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(parsed)) {
    errors.push({ index, field, message: `${label(field)} is required` });
    return;
  }
  if (parsed <= 0) {
    errors.push({ index, field, message: `${label(field)} must be greater than zero` });
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isoDate(value: unknown, field: string, index: number, errors: RecordError[]): void {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    errors.push({ index, field, message: `${label(field)} must be a date in YYYY-MM-DD format` });
    return;
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const roundTrips =
    parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  if (!roundTrips) {
    errors.push({ index, field, message: `${label(field)} is not a real date` });
  }
}

/** `first_name` -> `First name`, so messages read naturally without a per-field lookup table. */
function label(field: string): string {
  const words = field.replace(/_id$/, '').replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
