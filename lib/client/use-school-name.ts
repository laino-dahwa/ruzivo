'use client';

import { useQuery } from '@tanstack/react-query';
import { schoolsApi } from '../../services/schools';
import { useCurrentSchoolId } from './current-school-id';

/** Shown wherever a school has not been chosen, or has no name recorded. */
export const DEFAULT_APP_NAME = 'SSV Admin';

/**
 * The active school's name, for the places the app used to put its own.
 *
 * Falls back to the app name rather than rendering an empty heading: on first
 * run there is no school yet, and the shell still needs something to say.
 */
export function useSchoolName(): { name: string; isSchoolName: boolean } {
  const { schoolId } = useCurrentSchoolId();

  const query = useQuery({
    queryKey: ['school', schoolId],
    queryFn: () => schoolsApi.get(schoolId!),
    enabled: !!schoolId,
    staleTime: 60_000,
  });

  const name = query.data?.[0]?.school_name?.trim();
  return name ? { name, isSchoolName: true } : { name: DEFAULT_APP_NAME, isSchoolName: false };
}
