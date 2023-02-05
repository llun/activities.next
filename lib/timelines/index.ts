import { Actor } from '../models/actor'
import { Status } from '../models/status'
import { Storage } from '../storage/types'
import { mainTimelineRule } from './main'
import { Timeline } from './types'

export const addStatusToTimeline = async (
  storage: Storage,
  status: Status
): Promise<Timeline[]> => {
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
  for (const actor of actors) {
    const timeline = mainTimelineRule({
      currentActor: actor,
      status: status.data,
      storage
    })
  }

  return []
}
