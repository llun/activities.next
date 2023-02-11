import { Actor } from '../models/actor'
import { Status } from '../models/status'
import { Storage } from '../storage/types'
import { mainTimelineRule } from './main'
import { noannounceTimelineRule } from './noaanounce'

export const addStatusToTimelines = async (
  storage: Storage,
  status: Status
): Promise<void> => {
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

  const actors = [...localActors, ...getLocalActorsFromFollowerUrl]
  await Promise.all(
    actors
      .map((actor) => {
        return [mainTimelineRule, noannounceTimelineRule].map(
          async (timelineFunction) => {
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
          }
        )
      })
      .flat()
  )
}
