/** Formats a single event date/time. When `hasTime` is false, omits the time-of-day entirely
 * instead of showing a misleading 12:00 AM for a date-only event. */
export function formatEventDate(date: Date, hasTime: boolean, locale = 'en-GB'): string {
  return date.toLocaleString(locale, hasTime ? { dateStyle: 'full', timeStyle: 'short' } : { dateStyle: 'full' });
}

/** Formats an event's start (and optional end) into a single human-readable string:
 * - No end date: "27 July 2026" or "27 July 2026, 6:00 pm"
 * - Same-day range with times: "27 July 2026, 6:00 pm – 9:00 pm"
 * - Multi-day range: "27 July 2026 – 29 July 2026" */
export function formatEventDateRange(
  start: Date | null,
  end: Date | null | undefined,
  hasTime: boolean,
  locale = 'en-GB',
): string {
  if (!start) return 'soon';
  const startStr = formatEventDate(start, hasTime, locale);
  if (!end) return startStr;

  const sameDay = start.toDateString() === end.toDateString();
  if (sameDay && hasTime) {
    const dateStr = start.toLocaleString(locale, { dateStyle: 'full' });
    const startTime = start.toLocaleString(locale, { timeStyle: 'short' });
    const endTime = end.toLocaleString(locale, { timeStyle: 'short' });
    return `${dateStr}, ${startTime} – ${endTime}`;
  }
  if (sameDay) return startStr;

  const endStr = formatEventDate(end, hasTime, locale);
  return `${startStr} – ${endStr}`;
}
