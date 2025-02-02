import { Person } from '@llun/activities.schema'

import { Database } from '@/lib/database/types'
import { Attachment } from '@/lib/models/attachment'
import { Status } from '@/lib/models/status'
import { getPersonFromActor } from '@/lib/utils/getPersonFromActor'

type ProfileData = {
  person: Person
  statuses: Status[]
  attachments: Attachment[]
}

export const getProfileData = async (
  database: Database,
  actorHandle: string
): Promise<ProfileData | null> => {
  const [username, domain] = actorHandle.split('@').slice(1)
  const persistedActor = await database.getActorFromUsername({
    username,
    domain
  })
  if (persistedActor?.account) {
    const [statuses, attachments] = await Promise.all([
      database.getActorStatuses({ actorId: persistedActor.id }),
      database.getAttachmentsForActor({ actorId: persistedActor.id })
    ])
    return {
      person: getPersonFromActor(persistedActor),
      statuses,
      attachments
    }
  }

  return null
}
