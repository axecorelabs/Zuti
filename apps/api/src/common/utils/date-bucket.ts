/** YYYY-MM-DD from LOCAL date components — not toISOString(), which shifts the calendar date for
 * any timezone not exactly UTC+0 (e.g. WAT, UTC+1: local midnight today renders as "yesterday" in
 * ISO/UTC). Used to key daily activity buckets so chart labels match the server's local calendar. */
export function toLocalDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
