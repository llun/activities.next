const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const MONTH = 30 * DAY
const YEAR = 365 * DAY

/**
 * The compact relative time a post header shows next to the author ("35m",
 * "2h", "3d"), as drawn on the design system's Post card board. Every other
 * surface that prints a relative time (notifications, sessions, the edit
 * history panel, quote cards) keeps date-fns' `formatDistance` and is not
 * affected.
 *
 * Both arguments are explicit, so a caller can pass the server-provided
 * `currentTime` and render the same text on the server and in the browser (see
 * "Date Serialization in Server Components" in docs/architecture.md). The
 * output depends only on the difference between the two, never on a time zone
 * or the viewer's locale, which is why units run on past a week as weeks,
 * months and years instead of switching to a calendar date.
 *
 * Under a minute, and a timestamp slightly ahead of `now` (clock skew between
 * the origin server and this one), read "now". Units are truncated, never
 * rounded, so "59m" is followed by "1h" and not the other way round.
 */
export const formatCompactRelativeTime = (
  date: Date | number,
  now: Date | number
): string => {
  const delta = new Date(now).getTime() - new Date(date).getTime()

  if (!(delta >= MINUTE)) return 'now'
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m`
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h`
  if (delta < WEEK) return `${Math.floor(delta / DAY)}d`
  if (delta < MONTH) return `${Math.floor(delta / WEEK)}w`
  if (delta < YEAR) return `${Math.min(11, Math.floor(delta / MONTH))}mo`
  return `${Math.floor(delta / YEAR)}y`
}
