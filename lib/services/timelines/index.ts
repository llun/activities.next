import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/models/actor'
import { Status } from '@/lib/models/status'
import { getTracer } from '@/lib/utils/trace'

import { mainTimelineRule } from './main'
import { mentionTimelineRule } from './mention'
import { noannounceTimelineRule } from './noaanounce'

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
          actor !== undefined && actor.privateKey !== ''
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
      await Promise.all(
        actors
          .map((actor) => {
            return [
              mainTimelineRule,
              noannounceTimelineRule,
              mentionTimelineRule
            ].map(async (timelineFunction) => {
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
          })
          .flat()
      )
      span.end()
    }
  )
}
