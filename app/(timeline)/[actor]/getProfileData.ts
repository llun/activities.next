import { getActorFollowers } from '@/lib/activities/getActorFollowers'
import { getActorFollowing } from '@/lib/activities/getActorFollowing'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getActorPosts } from '@/lib/activities/getActorPosts'
import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import { Database } from '@/lib/database/types'
import { aliasServedLocalActor } from '@/lib/services/actors/aliasServedLocalActor'
import { Actor } from '@/lib/types/activitypub'
import { Actor as DomainActor } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import { Status } from '@/lib/types/domain/status'
import { getActorImageUrl } from '@/lib/utils/activitypubActor'
import { getPersonFromActor } from '@/lib/utils/getPersonFromActor'

type ProfileData = {
  person: Actor
  statuses: Status[]
  statusesCount: number
  statusPagination: {
    nextPageUrl: string | null
    prevPageUrl: string | null
  }
  attachments: Attachment[]
  followingCount: number
  followersCount: number
  isInternalAccount: boolean
  hasFitnessData: boolean
}

type ProfileDataOptions = {
  statusPageUrl?: string
}

export const getProfileData = async (
  database: Database,
  actorHandle: string,
  isLoggedIn: boolean = true,
  signingActor?: DomainActor,
  options: ProfileDataOptions = {}
): Promise<ProfileData | null> => {
  const [username, domain] = actorHandle.split('@').slice(1)
  let persistedActor = await database.getActorFromUsername({
    username,
    domain
  })

  // No local actor on the queried domain: if it is a host this instance serves
  // as (a trusted alias of the canonical host), resolve to the canonical local
  // actor before falling through to a remote fetch. Mirrors the
  // WebFinger/lookup/search routes; `?? persistedActor` keeps a genuinely-remote
  // row untouched.
  if (!persistedActor?.account) {
    persistedActor =
      (await aliasServedLocalActor({ database, username, domain })) ??
      persistedActor
  }

  if (persistedActor?.account) {
    const [
      statuses,
      statusesCount,
      attachments,
      followingCount,
      followersCount,
      hasFitnessData
    ] = await Promise.all([
      database.getActorStatuses({ actorId: persistedActor.id }),
      database.getActorStatusesCount({ actorId: persistedActor.id }),
      database.getAttachmentsForActor({ actorId: persistedActor.id }),
      database.getActorFollowingCount({ actorId: persistedActor.id }),
      database.getActorFollowersCount({ actorId: persistedActor.id }),
      database.getActorHasFitnessData({ actorId: persistedActor.id })
    ])
    return {
      person: getPersonFromActor(persistedActor),
      statuses,
      statusesCount,
      statusPagination: {
        nextPageUrl: null,
        prevPageUrl: null
      },
      attachments,
      followingCount,
      followersCount,
      isInternalAccount: true,
      hasFitnessData
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
      iconUrl: getActorImageUrl(person.icon),
      headerImageUrl: getActorImageUrl(person.image),
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
    getActorPosts({
      database,
      person,
      pageUrl: options.statusPageUrl,
      ...signingParams
    }),
    database.getAttachmentsForActor({ actorId: person.id }),
    getActorFollowing({ person, ...signingParams }),
    getActorFollowers({ person, ...signingParams })
  ])

  return {
    ...actorPostsResponse,
    person,
    statusPagination: {
      nextPageUrl: actorPostsResponse.nextPageUrl ?? null,
      prevPageUrl: actorPostsResponse.prevPageUrl ?? null
    },
    attachments,
    followingCount: actorFollowingResponse.followingCount,
    followersCount: actorFollowersResponse.followerCount,
    isInternalAccount: false,
    hasFitnessData: false
  }
}
