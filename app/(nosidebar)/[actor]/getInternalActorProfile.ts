import { Storage } from '@/lib/database/types'
import { Actor } from '@/lib/models/actor'

export const getInternalActorProfile = async (
  storage: Storage,
  actor: Actor
) => {
  const [statuses, attachments] = await Promise.all([
    storage.getActorStatuses({ actorId: actor.id }),
    storage.getAttachmentsForActor({ actorId: actor.id })
  ])
  return {
    person: actor.toPublicProfile(),
    statuses: statuses.map((item) => item.toJson()),
    attachments: attachments.map((item) => item.toJson())
  }
}
