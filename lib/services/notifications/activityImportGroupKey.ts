/**
 * Bucket activity-import notifications by UTC day, so a bulk import of a
 * season's rides groups into one notification per day instead of hundreds.
 *
 * Keyed on the activity's own start time rather than the import time, so
 * re-importing an old file lands in the bucket it belongs to.
 */
export const getActivityImportGroupKey = (
  actorId: string,
  activityStartTime?: number | null
) => {
  const date = activityStartTime ? new Date(activityStartTime) : new Date()
  const dateStr = Number.isNaN(date.getTime())
    ? new Date().toISOString().slice(0, 10)
    : date.toISOString().slice(0, 10)
  return `activity_import:${actorId}:${dateStr}`
}
