/**
 * The fitness overview's `?activity=` filter, spelled once.
 *
 * The filter lives in the URL rather than in dashboard state so the
 * recent-activities list is narrowed by the same server query that builds it —
 * a client-side filter over the five already-fetched posts would show whichever
 * of them happened to match, not the five most recent of that type. That splits
 * the contract across three files (the page reads it, the Activities table
 * links to it, the chip clears it), two of which are Server Components and one
 * a Client Component, so it belongs in a plain module all three can import.
 */

const ACTIVITY_FILTER_PARAM = 'activity'

const FITNESS_OVERVIEW_PATH = '/fitness'

/**
 * The stored `activityType` the recent-activities list is narrowed to, or
 * `undefined` for no filter.
 *
 * A repeated or blank param is no filter: the value is matched verbatim against
 * `fitness_files.activityType`, and `''` is not a value any activity is stored
 * under.
 */
export const readActivityTypeParam = (
  params: Record<string, string | string[] | undefined>
): string | undefined => {
  const value = params[ACTIVITY_FILTER_PARAM]
  const activityType = Array.isArray(value) ? value[0] : value
  return activityType ? activityType : undefined
}

/**
 * Where an activity row's name links. Clicking the row already filtered to
 * clears the filter, so one control both applies and removes it — the same
 * toggle the chip beside "Recent activities" offers.
 */
export const getActivityFilterHref = (
  activityType: string,
  isSelected: boolean
): string =>
  isSelected
    ? FITNESS_OVERVIEW_PATH
    : `${FITNESS_OVERVIEW_PATH}?${ACTIVITY_FILTER_PARAM}=${encodeURIComponent(activityType)}`

/** Where the chip beside "Recent activities" goes: the unfiltered overview. */
export const CLEAR_ACTIVITY_FILTER_HREF = FITNESS_OVERVIEW_PATH
