import { Actor } from '../models/actor'
import { Status } from '../models/status'
import { Storage } from '../storage/types'
import { mainTimelineRule } from './main'

export const addStatusToTimelines = async (
  storage: Storage,
  status: Status
): Promise<void> => {
  const { to, cc } = status
  const recipients = [...to, ...cc]
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
    actors.map(async (actor) => {
      const timeline = await mainTimelineRule({
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
  )
}
