// The single source of truth for "what calendar day" a timestamp falls on in
// reports. Matches the Postgres server's own configured session timezone
// (confirmed via `SHOW timezone`), made explicit here instead of relying on
// that session default, so date-boundary filtering can't silently drift if
// the server's timezone configuration ever changes.
export const REPORT_TIMEZONE = "Africa/Johannesburg";
