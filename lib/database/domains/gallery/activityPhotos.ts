import type { Db } from '@/lib/database/kysely'
import { countableActivity } from '@/lib/database/kysely/countableActivity'

/**
 * The owner's attachments on statuses that carry a countable activity: one row
 * per (attachment, activity). The generated route map (`isRouteMap`) is left
 * out unless `includeRouteMap`: it is not a photo of the activity, but it is
 * still media from the activity's post, so "not from an activity" counts it as
 * one. The flag survives a post edit that renames the map and a photo editor
 * re-render that moves its url.
 */
export const activityPhotoAttachments = (
  db: Db,
  actorId: string,
  { includeRouteMap = false }: { includeRouteMap?: boolean } = {}
) => {
  let query = db
    .selectFrom('attachments as activity_attachments')
    .innerJoin(
      'fitness_files',
      'fitness_files.statusId',
      'activity_attachments.statusId'
    )
    .where('activity_attachments.actorId', '=', actorId)
    .where('activity_attachments.mediaId', 'is not', null)
  if (!includeRouteMap) {
    query = query.where('activity_attachments.isRouteMap', '=', false)
  }
  return query
    .where('fitness_files.actorId', '=', actorId)
    .where((eb) => countableActivity(eb))
}
