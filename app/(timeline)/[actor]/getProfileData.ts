import { getActorFollowers } from '@/lib/activities/getActorFollowers'
import { getActorFollowing } from '@/lib/activities/getActorFollowing'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getActorPosts } from '@/lib/activities/getActorPosts'
import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/activitypub'
import { Actor as DomainActor } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import { Status } from '@/lib/types/domain/status'
import { getPersonFromActor } from '@/lib/utils/getPersonFromActor'

type ProfileData = {
  person: Actor
  statuses: Status[]
  statusesCount: number
  attachments: Attachment[]
  followingCount: number
  followersCount: number
  isInternalAccount: boolean
}

export const getProfileData = async (
  database: Database,
  actorHandle: string,
  isLoggedIn: boolean = true,
  signingActor?: DomainActor
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
      followersCount,
      isInternalAccount: true
    }
  }

  // Remote actors: only fetch if user is logged in
  if (!isLoggedIn) {
    return null
  }

  const actorId = await getWebfingerSelf({ account: actorHandle.slice(1) })
  if (!actorId) return null

  const signingParams = signingActor ? { signingActor } : {}
  const person = await getActorPerson({ actorId, ...signingParams })
  if (!person) return null

  if (persistedActor) {
    await database.updateActor({
      actorId: person.id,
      name: person.name,
      summary: person.summary || '',
      iconUrl: person.icon?.url || '',
      headerImageUrl: person.image?.url || '',
      publicKey: person.publicKey.publicKeyPem,
      followersUrl: person.followers,
      inboxUrl: person.inbox,
      sharedInboxUrl: person.endpoints?.sharedInbox || ''
    })
  }

  const [
    actorPostsResponse,
    attachments,
    actorFollowingResponse,
    actorFollowersResponse
  ] = await Promise.all([
    getActorPosts({ database, person, ...signingParams }),
    database.getAttachmentsForActor({ actorId: person.id }),
    getActorFollowing({ person, ...signingParams }),
    getActorFollowers({ person, ...signingParams })
  ])

  return {
    ...actorPostsResponse,
    person,
    attachments,
    followingCount: actorFollowingResponse.followingCount,
    followersCount: actorFollowersResponse.followerCount,
    isInternalAccount: false
  }
}
