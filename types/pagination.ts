// Shared by the API (lib/pagination.ts) and the client services.

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/** One page of a long list — see lib/pagination.ts. */
export type Page<T> = {
  rows: T[];
  /** Pass back as `cursor` for the next page; null when this was the last. */
  next_cursor: string | null;
  /** Totals across every matching row, not just this page. First page only. */
  total_count?: number;
  total_amount?: string;
};
