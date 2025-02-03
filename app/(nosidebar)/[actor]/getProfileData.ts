import { Person } from '@llun/activities.schema'

import { getActorPerson } from '@/lib/activities/requests/getActorPerson'
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

  const person = await getActorPerson({ actorId: actorHandle })
  if (!person) {
    return null
  }

  const [statuses, attachments] = await Promise.all([
    getActorPosts({ postsUrl: profile.urls?.posts }),
    database.getAttachmentsForActor({ actorId: profile.id })
  ])
  return { person, statuses: [], attachments: [] }
}
