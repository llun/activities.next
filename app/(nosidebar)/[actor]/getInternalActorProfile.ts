import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/models/actor'
import { cleanJson } from '@/lib/utils/cleanJson'
import { getPersonFromActor } from '@/lib/utils/getPersonFromActor'

export const getInternalActorProfile = async (
  database: Database,
  actor: Actor
) => {
  const [statuses, attachments] = await Promise.all([
    database.getActorStatuses({ actorId: actor.id }),
    database.getAttachmentsForActor({ actorId: actor.id })
  ])
  return {
    person: getPersonFromActor(actor),
    statuses: statuses.map((item) => cleanJson(item)),
    attachments: attachments.map((item) => item.toJson())
  }
}
