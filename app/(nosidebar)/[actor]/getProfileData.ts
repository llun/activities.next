import { Person } from '@llun/activities.schema'

import { getActorFollowers } from '@/lib/activities/requests/getActorFollowers'
import { getActorFollowing } from '@/lib/activities/requests/getActorFollowing'
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
  followingCount: number
  followersCount: number
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
    const [
      statuses,
      statusesCount,
      attachments,
      followingCount,
      followersCount
    ] = await Promise.all([
      database.getActorStatuses({ actorId: persistedActor.id }),
      database.getActorStatusesCount({ actorId: persistedActor.id }),
      database.getAttachmentsForActor({ actorId: persistedActor.id }),
      database.getActorFollowingCount({ actorId: persistedActor.id }),
      database.getActorFollowersCount({ actorId: persistedActor.id })
    ])
    return {
      person: getPersonFromActor(persistedActor),
      statuses,
      statusesCount,
      attachments,
      followingCount,
      followersCount
    }
  }

  const person = await getActorPerson({ actorId: actorHandle })
  if (!person) {
    return null
  }

  const [
    actorPostsResponse,
    attachments,
    actorFollowingResponse,
    actorFollowersResponse
  ] = await Promise.all([
    getActorPosts({ database, person }),
    database.getAttachmentsForActor({ actorId: person.id }),
    getActorFollowing({ person }),
    getActorFollowers({ person })
  ])
  return {
    ...actorPostsResponse,
    person,
    attachments,
    followingCount: actorFollowingResponse.followingCount,
    followersCount: actorFollowersResponse.followerCount
  }
}
