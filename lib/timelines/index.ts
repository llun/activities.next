import { Actor } from '../models/actor'
import { Status } from '../models/status'
import { Storage } from '../storage/types'
import { getSpan } from '../trace'
import { mainTimelineRule } from './main'
import { mentionTimelineRule } from './mention'
import { noannounceTimelineRule } from './noaanounce'

export const addStatusToTimelines = async (
  storage: Storage,
  status: Status
): Promise<void> => {
  const span = getSpan('timelines', 'addStatusToTimelines', {
    statusId: status.id
  })
  const { to, cc, actorId } = status
  const recipients = [...to, ...cc, actorId]
  const localActors = (
    await Promise.all(recipients.map((id) => storage.getActorFromId({ id })))
  ).filter(
    (actor): actor is Actor => actor !== undefined && actor.privateKey !== ''
  )
  const getLocalActorsFromFollowerUrl = (
    await Promise.all(
      recipients.map((id) =>
        storage.getLocalActorsFromFollowerUrl({ followerUrl: id })
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
            status: status.data,
            storage
          })
          if (!timeline) return
          return storage.createTimelineStatus({
            actorId: actor.id,
            status,
            timeline
          })
        })
      })
      .flat()
  )
  span?.finish()
}
