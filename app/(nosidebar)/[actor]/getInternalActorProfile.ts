import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/models/actor'
import { cleanJson } from '@/lib/utils/cleanJson'

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
    statuses: statuses.map((item) => cleanJson(item)),
    attachments: attachments.map((item) => item.toJson())
  }
}
