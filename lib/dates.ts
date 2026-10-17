/**
 * Today's (or a given moment's) date as YYYY-MM-DD in the machine's own
 * timezone.
 *
 * Not `toISOString().slice(0, 10)`: that is the UTC date, which in Zimbabwe
 * (UTC+2) is still yesterday until 02:00 — so a document issued just after
 * midnight would carry the previous day's date on its face and its stamp.
 * The desktop app's server runs on the school's own machine, so local time
 * is the school's time. Safe to import from client and server code alike.
 */
export function localDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
