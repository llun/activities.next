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
 * The `?activity=` value as it arrived, or `undefined` when the param is absent
 * or blank. A repeated param takes the FIRST value.
 *
 * This is the raw request, not the filter — nothing here has checked that the
 * value names anything. `resolveActivityTypeFilter` below is what turns it into
 * one, and every caller must go through that.
 */
export const readActivityTypeParam = (
  params: Record<string, string | string[] | undefined>
): string | undefined => {
  const value = params[ACTIVITY_FILTER_PARAM]
  const activityType = Array.isArray(value) ? value[0] : value
  return activityType ? activityType : undefined
}

/**
 * The activity type the page will actually filter by: the requested value if it
 * names one of the actor's own stored types, and otherwise `undefined` — the
 * unfiltered overview.
 *
 * A search param is attacker-controlled and reaches two places that cannot
 * defend themselves. It is rendered as prose ("No recent <label> activities
 * have been posted.") and as the clear chip's text and `aria-label`, so an
 * unchecked value lets a crafted link put arbitrary words on the victim's own
 * signed-in page in the instance's own voice — the same reflected-copy shape
 * `REVIEW.md` documents for the auth error page. And it is compared against
 * `fitness_files.activityType`, where a value no row can hold is at best a
 * guaranteed miss and at worst an error (PostgreSQL rejects a NUL byte in a
 * text comparison, turning a junk URL into a 500).
 *
 * Matching against the actor's own list answers both at once, and needs no
 * length or character rules that could drift from the column: a value that
 * names no stored type is simply not a filter. `getDistinctActivityTypesForActor`
 * applies the same completed/primary/not-deleted predicate as the
 * recent-activities query, so the accepted set is exactly the set of rows that
 * query could return — and exactly the set the Activities table links to.
 */
export const resolveActivityTypeFilter = (
  requestedActivityType: string | undefined,
  availableActivityTypes: string[]
): string | undefined =>
  requestedActivityType &&
  availableActivityTypes.includes(requestedActivityType)
    ? requestedActivityType
    : undefined

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
