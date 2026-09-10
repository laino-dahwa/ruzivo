import type { AcademicYear } from '../../types/reference-data';

/**
 * The academic year covering today.
 *
 * Reference data arrives in insertion order, so `academicYears[0]` is the
 * oldest year a school ever created — reaching for it silently attributed
 * payments, and dated period reports, to a year that closed long ago.
 *
 * Falls back to a record simply named for the current year (a year whose
 * end_date has passed still has to accept payments), then to the first record
 * so a school that has not dated its years behaves as it always did.
 */
export function currentAcademicYear(years: AcademicYear[] | undefined): AcademicYear | undefined {
  if (!years?.length) return undefined;

  const today = new Date();
  const covering = years.find((year) => {
    const start = new Date(year.start_date);
    const end = new Date(year.end_date);
    return !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && today >= start && today <= end;
  });
  const named = years.find((year) => String(year.academic_year_name ?? '').trim() === String(today.getFullYear()));

  return covering ?? named ?? years[0];
}
