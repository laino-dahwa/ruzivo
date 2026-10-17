'use client';

import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import { formatCurrency } from '../../lib/currency';
import type { Page } from '../../types/pagination';

/**
 * A "load more" list over one of the paged endpoints (see lib/pagination.ts).
 * Only the pages the user has asked for are ever fetched; totals come from
 * the server with the first page, so they cover every matching row.
 */
export function usePagedList<T>(options: {
  queryKey: QueryKey;
  fetchPage: (cursor: string | null) => Promise<Page<T>>;
  enabled?: boolean;
}) {
  const query = useInfiniteQuery({
    queryKey: options.queryKey,
    queryFn: ({ pageParam }) => options.fetchPage(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    enabled: options.enabled,
  });

  const firstPage = query.data?.pages[0];
  return {
    query,
    rows: query.data?.pages.flatMap((page) => page.rows) ?? [],
    totalCount: firstPage?.total_count ?? 0,
    totalAmount: firstPage?.total_amount ?? '0',
  };
}

export function PagedListFooter({
  shown,
  totalCount,
  totalAmount,
  noun,
  hasMore,
  loadingMore,
  onLoadMore,
  testId,
}: {
  shown: number;
  totalCount: number;
  totalAmount: string;
  noun: string;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  testId?: string;
}) {
  if (totalCount === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
      <span className="text-muted-foreground" data-testid={testId ? `${testId}-summary` : undefined}>
        Showing {shown.toLocaleString()} of {totalCount.toLocaleString()} {noun} ·{' '}
        <span className="font-semibold text-foreground">Total {formatCurrency(totalAmount)}</span>
      </span>
      {hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loadingMore}
          className="button-lift h-8 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground hover:border-primary/50 disabled:opacity-60"
          data-testid={testId ? `${testId}-load-more` : undefined}
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
