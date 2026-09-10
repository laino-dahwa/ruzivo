'use client';

import { useQuery } from '@tanstack/react-query';
import { request } from '../../services/http';

type LogoMeta = { hasLogo: boolean; stamp: string | null };

/**
 * Whether the active school has a logo, and the stamp that busts caches when it
 * is replaced. Kept to a metadata call so the sidebar and the browser tab do not
 * each pull the image bytes on every render.
 */
export function useSchoolLogo(schoolId: string | null) {
  const query = useQuery({
    queryKey: ['school-logo', schoolId],
    queryFn: () => request<LogoMeta>(`/api/schools/${encodeURIComponent(schoolId!)}/logo?meta=1`),
    enabled: !!schoolId,
    staleTime: 60_000,
  });

  return { hasLogo: query.data?.hasLogo ?? false, stamp: query.data?.stamp ?? null };
}
