import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
import { isDirectStatus } from '@/lib/utils/directStatus'
import { getTracer } from '@/lib/utils/trace'

import { getBlockedRecipientActorIdsForStatus } from './blockFilter'
import { mainTimelineRule } from './main'
import { mentionTimelineRule } from './mention'
import { noannounceTimelineRule } from './noaanounce'
import { Timeline } from './types'

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
      // old live list query scanned.
      await database.addStatusToListTimelines({ status })

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
