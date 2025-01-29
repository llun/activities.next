import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/models/actor'

export const getInternalActorProfile = async (
  database: Database,
  actor: Actor
) => {
  const [statuses, attachments] = await Promise.all([
    database.getActorStatuses({ actorId: actor.id }),
    database.getAttachmentsForActor({ actorId: actor.id })
  ])
  return {
    person: actor.toPublicProfile(),
    statuses: statuses.map((item) => item.toJson()),
    attachments: attachments.map((item) => item.toJson())
  }
}
