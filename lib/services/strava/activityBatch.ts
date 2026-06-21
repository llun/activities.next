// A fitness import triggered by a single Strava activity (webhook or
// re-trigger) is grouped under the import batch id `strava-activity:<id>`. These
// helpers are the single source of truth for that format so the importer, the
// retry endpoint, and ops tooling agree on how to build and parse it.
export const STRAVA_ACTIVITY_BATCH_PREFIX = 'strava-activity:'

export const getStravaActivityBatchId = (stravaActivityId: string): string =>
  `${STRAVA_ACTIVITY_BATCH_PREFIX}${stravaActivityId}`

export const getStravaActivityIdFromBatchId = (
  batchId: string
): string | null => {
  if (!batchId.startsWith(STRAVA_ACTIVITY_BATCH_PREFIX)) {
    return null
  }

  const stravaActivityId = batchId.slice(STRAVA_ACTIVITY_BATCH_PREFIX.length)
  return stravaActivityId.length > 0 ? stravaActivityId : null
}
