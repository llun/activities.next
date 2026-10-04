/**
 * Shared shapes for the fitness overview: the database layer, the API routes,
 * the client transport and the UI all speak these.
 *
 * The module is dependency-free (no React, no Node APIs, no project imports),
 * like the rest of `lib/fitness/calendar`, so any of those layers can import
 * it. Dates are `YYYY-MM-DD` keys in the viewer's local zone (see
 * `localDay.ts`); instants are epoch milliseconds.
 */

/**
 * One local day's totals. Only days with at least one countable activity exist;
 * a day without rows has no entry rather than a zero entry.
 */
export interface FitnessCalendarDay {
  /** `YYYY-MM-DD` in the viewer's zone. */
  date: string
  count: number
  totalDistanceMeters: number
  totalDurationSeconds: number
  totalElevationGainMeters: number
}

/**
 * One activity-type group of the summary. `activityType` is `null` for
 * activities that carry no type, which are counted like any other so the
 * totals equal the calendar's sum for the same range. It is never the string
 * `"null"`.
 */
export interface FitnessActivitySummary {
  activityType: string | null
  count: number
  totalDistanceMeters: number
  totalDurationSeconds: number
  totalElevationGainMeters: number
}

/**
 * A countable activity as the database returns it for the day details: the
 * same predicate as the calendar and summary reads. Everything but `id` and
 * `startTime` may be missing on the stored row.
 */
export interface FitnessWindowActivity {
  /** `fitness_files.id`. */
  id: string
  /**
   * The post the activity was published as. `null` once that post is deleted
   * (deleting a status only clears the column), and for a file never posted.
   */
  statusId: string | null
  activityType: string | null
  /** Epoch milliseconds. */
  startTime: number
  totalDistanceMeters: number | null
  totalDurationSeconds: number | null
  elevationGainMeters: number | null
  /** Title sources, in the order a caller should prefer them after the post. */
  description: string | null
  fileName: string
}

/** One page of `FitnessWindowActivity`, ordered by start time then id. */
export interface FitnessWindowActivityPage {
  activities: FitnessWindowActivity[]
  /** True when at least one more row exists beyond this page. */
  hasMore: boolean
}

/** The earliest countable activity, for bounding the range pickers. */
export interface FitnessActivityTimeBounds {
  /** Epoch milliseconds, or `null` when the actor has no countable activity. */
  earliest: number | null
}

/** One row of the day-details list, as the day route returns it. */
export interface FitnessDayActivity {
  id: string
  activityType: string | null
  /** Epoch milliseconds. */
  startTime: number
  totalDistanceMeters: number | null
  totalDurationSeconds: number | null
  elevationGainMeters: number | null
  /** First line of the post's text; `null` when the post is unavailable. */
  title: string | null
  /** The activity's detail page; `null` when the post is unavailable. */
  statusPath: string | null
}

export interface FitnessDayActivitiesPage {
  /** `YYYY-MM-DD` in `timeZone`. */
  date: string
  timeZone: string
  activities: FitnessDayActivity[]
  hasMore: boolean
  /** Rows consumed so far, so the next page starts here. */
  nextOffset: number
}
