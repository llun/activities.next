import { sql } from 'kysely'

import type { Db } from '@/lib/database/kysely'
import { countableActivity } from '@/lib/database/kysely/countableActivity'

// Equals ROUTE_MAP_ATTACHMENT_NAME (services/fitness-files/mapAttachments),
// which is not imported here: that module pulls the media services into the
// database layer and breaks its import order. A filters test pins the two.
export const ROUTE_MAP_NAME = 'Activity route map'

/**
 * The owner's attachments on statuses that carry a countable activity: one row
 * per (attachment, activity). The generated route map is left out unless
 * `includeRouteMap`: it is not a photo of the activity, but it is still media
 * from the activity's post, so "not from an activity" counts it as one.
 *
 * The map is recognised by the file's recorded `mapImagePath` (what hydration
 * uses) because an edit that resends media_ids renames the attachment; the
 * name check stays as a second signal. The path is matched as a url suffix
 * with substr, not LIKE, so `%` and `_` in a path are not wildcards.
 * shortcut: a url that percent-encodes the path is not matched here, generated
 * map paths never need encoding. A route map that the photo editor re-renders
 * ("Update posts" moves its url) and that a post edit renames matches neither
 * signal, so it is counted as a photo; same limit as hydration.
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
    query = query
      .where((eb) =>
        eb.or([
          eb('activity_attachments.name', 'is', null),
          eb('activity_attachments.name', '<>', ROUTE_MAP_NAME)
        ])
      )
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('fitness_files as map_files')
              .select(sql.lit(1).as('one'))
              .whereRef(
                'map_files.statusId',
                '=',
                'activity_attachments.statusId'
              )
              .where('map_files.mapImagePath', 'is not', null)
              .where(
                sql<boolean>`substr(${sql.ref('activity_attachments.url')}, length(${sql.ref('activity_attachments.url')}) - length(${sql.ref('map_files.mapImagePath')}) + 1) = ${sql.ref('map_files.mapImagePath')}`
              )
          )
        )
      )
  }
  return query
    .where('fitness_files.actorId', '=', actorId)
    .where((eb) => countableActivity(eb))
}
