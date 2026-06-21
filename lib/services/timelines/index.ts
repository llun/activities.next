import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
import { isDirectStatus } from '@/lib/utils/directStatus'
import { logger } from '@/lib/utils/logger'
import { getTracer } from '@/lib/utils/trace'

import { getBlockedRecipientActorIdsForStatus } from './blockFilter'
import { mainTimelineRule } from './main'
import { mentionTimelineRule } from './mention'
import { noannounceTimelineRule } from './noaanounce'
import { Timeline } from './types'

// The list and collection feeds are materialized, rebuildable projections of
// the `statuses` table (the same membership-driven fan-out the live query once
// scanned; lists even ship a `backfill_list_timelines` migration). The status
// row and its core home/mention/direct timelines are the source of truth. A
// failure here — e.g. a database mid-migration where the `collection_*`/`list_*`
// tables do not exist yet, or a transient DB error — must NOT abort status
// creation and lose the post itself, which would orphan imported fitness files
// (no status, no page link). Log and continue; the projection can be rebuilt.
const materializeAuxiliaryFeed = async (
  feedName: string,
  status: Status,
  populate: () => Promise<void>
): Promise<void> => {
  try {
    await populate()
  } catch (error) {
    const nodeError = error as Error
    logger.error({
      message: `Failed to materialize ${feedName} for status; continuing`,
      statusId: status.id,
      actorId: status.actorId,
      error: nodeError.message
    })
  }
}

export const addStatusToTimelines = async (
  database: Database,
  status: Status
): Promise<void> => {
  return getTracer().startActiveSpan(
    'timelines.addStatusToTimelines',
    { attributes: { statusId: status.id } },
    async (span) => {
      const { to, cc, actorId } = status
      const recipients = [...to, ...cc, actorId]
      const localActors = (
        await Promise.all(
          recipients.map((id) => database.getActorFromId({ id }))
        )
      ).filter(
        (actor): actor is Actor =>
          actor !== undefined && actor !== null && actor.privateKey !== ''
      )
      const getLocalActorsFromFollowerUrl = (
        await Promise.all(
          recipients.map((id) =>
            database.getLocalActorsFromFollowerUrl({ followerUrl: id })
          )
        )
      ).flat()

      const actors = Object.values(
        [...localActors, ...getLocalActorsFromFollowerUrl].reduce(
          (output, actor) => {
            return {
              ...output,
              [actor.id]: actor
            }
          },
          {} as { [key in string]: Actor }
        )
      )
      const blockedRecipientActorIds =
        await getBlockedRecipientActorIdsForStatus(
          database,
          actors.map((actor) => actor.id),
          status
        )
      // Fan the post into the materialized feed of every list that includes its
      // author (independent of the recipient fan-out below, since list ownership
      // — not delivery — decides list membership). Visibility/replies-policy are
      // enforced at read time, so this materializes the same candidate set the
      // old live list query scanned. Best-effort: see materializeAuxiliaryFeed.
      await materializeAuxiliaryFeed('list timelines', status, () =>
        database.addStatusToListTimelines({ status })
      )
      // Likewise fan the post into the capped feed of every collection whose
      // membership includes its author. The owner/public projections (and the
      // public-only visibility filter) are applied at read time. Best-effort.
      await materializeAuxiliaryFeed('collection timelines', status, () =>
        database.addStatusToCollectionTimelines({ status })
      )

      const isDirect = isDirectStatus(status)
      if (isDirect) {
        await database.syncDirectConversationForStatus({
          status,
          excludedLocalActorIds: [...blockedRecipientActorIds]
        })
      }

      await Promise.all(
        actors.map(async (actor) => {
          if (blockedRecipientActorIds.has(actor.id)) return

          if (isDirect) {
            await database.createTimelineStatus({
              actorId: actor.id,
              status,
              timeline: Timeline.DIRECT
            })
          }

          await Promise.all(
            (isDirect
              ? []
              : [mainTimelineRule, noannounceTimelineRule, mentionTimelineRule]
            ).map(async (timelineFunction) => {
              const timeline = await timelineFunction({
                currentActor: actor,
                status,
                database
              })
              if (!timeline) return
              return database.createTimelineStatus({
                actorId: actor.id,
                status,
                timeline
              })
            })
          )
        })
      )
      span.end()
    }
  )
}
