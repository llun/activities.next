import { Person } from '@llun/activities.schema'

import { getActorPerson } from '@/lib/activities/requests/getActorPerson'
import { getActorPosts } from '@/lib/activities/requests/getActorPosts'
import { Database } from '@/lib/database/types'
import { Attachment } from '@/lib/models/attachment'
import { Status } from '@/lib/models/status'
import { getPersonFromActor } from '@/lib/utils/getPersonFromActor'

type ProfileData = {
  person: Person
  statuses: Status[]
  statusesCount: number
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
    const [statuses, statusesCount, attachments] = await Promise.all([
      database.getActorStatuses({ actorId: persistedActor.id }),
      database.getActorStatusesCount({ actorId: persistedActor.id }),
      database.getAttachmentsForActor({ actorId: persistedActor.id })
    ])
    return {
      person: getPersonFromActor(persistedActor),
      statuses,
      statusesCount,
      attachments
    }
  }

  const person = await getActorPerson({ actorId: actorHandle })
  if (!person) {
    return null
  }

  const [actorPostsResponse, attachments] = await Promise.all([
    getActorPosts({ database, person }),
    database.getAttachmentsForActor({ actorId: person.id })
  ])
  return {
    ...actorPostsResponse,
    person,
    attachments
  }
}
