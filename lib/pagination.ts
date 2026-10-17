/**
 * Keyset ("load more") paging for the long lists — payments and expenses.
 *
 * A page is requested with `?limit=N` and, after the first page, the
 * `cursor` the previous page returned. The cursor is the sort key of the last
 * row sent (e.g. its timestamp + id), so the next page is a plain index range
 * scan from that point — page 200 costs the same as page 1, unlike OFFSET,
 * which has to read and throw away every earlier row.
 *
 * Totals (row count and amount) come from the database alongside the first
 * page only, so the client never needs every row just to add them up.
 */

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../types/pagination";

export type { Page } from "../types/pagination";

/** `?limit=` as a page size, or null when the caller asked for no paging. */
export function parseLimit(searchParams: URLSearchParams): number | null {
  const raw = searchParams.get("limit");
  if (raw === null || raw === "" || raw === "null") return null;
  const limit = Number.parseInt(raw, 10);
  if (!Number.isFinite(limit) || limit < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(limit, MAX_PAGE_SIZE);
}

/**
 * The cursor is opaque to the client: a base64url-encoded JSON pair of the
 * last row's sort key. Timestamps travel as Postgres's own text form, so
 * microsecond precision survives the round trip (a JS Date would truncate to
 * milliseconds and could skip or repeat rows).
 */
export function encodeCursor(sortValue: string, id: string | number): string {
  return Buffer.from(JSON.stringify([sortValue, String(id)])).toString("base64url");
}

/** Null for a missing or malformed cursor — treated as "first page". */
export function decodeCursor(cursor: string | null): { sortValue: string; id: string } | null {
  if (!cursor || cursor === "null") return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[0] === "string" && /^\d+$/.test(parsed[1])) {
      return { sortValue: parsed[0], id: parsed[1] };
    }
  } catch {
    // fall through
  }
  return null;
}
