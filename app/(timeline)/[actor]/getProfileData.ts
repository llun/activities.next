import { getActorFollowers } from '@/lib/activities/getActorFollowers'
import { getActorFollowing } from '@/lib/activities/getActorFollowing'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getActorPosts } from '@/lib/activities/getActorPosts'
import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import { Database } from '@/lib/database/types'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { Actor } from '@/lib/types/activitypub'
import { Attachment } from '@/lib/types/domain/attachment'
import { Status } from '@/lib/types/domain/status'
import { getActorImageUrl } from '@/lib/utils/activitypubActor'
import { getPersonFromActor } from '@/lib/utils/getPersonFromActor'
import { logger } from '@/lib/utils/logger'

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
  options: ProfileDataOptions = {}
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

  // Server-to-server federation fetches must be signed by the dedicated
  // headless instance actor, never the viewer's user actor. Instances running
  // in authorized-fetch ("secure") mode reject unsigned requests with 401, and
  // the viewer may not have a usable signing actor at all (e.g. a logged-in
  // account without a local actor yet, or one whose key is not publicly
  // resolvable). The instance actor always exists, always has a private key,
  // and is served at a publicly resolvable URL so the remote can fetch its key
  // and verify the signature. This is the same headless signer used by the
  // federation jobs and relay/follow flows (getFederationSigningActor); without
  // it, secure-mode remote profiles 404.
  //
  // WebFinger discovery and signer resolution are independent, so resolve them
  // concurrently to avoid stacking their latencies on the profile render.
  // Signer resolution is best-effort: a missing/failed instance actor must not
  // turn a clean 404 (unknown actor) into a 500, so a failure degrades to an
  // unsigned fetch via the `signingActor`-less branch below.
  const [actorId, signingActor] = await Promise.all([
    getWebfingerSelf({ account: actorHandle.slice(1) }),
    getFederationSigningActor(database).catch((error) => {
      // Degrade to an unsigned fetch, but surface the failure so a persistently
      // broken signer (which would silently 404 every secure-mode profile)
      // remains diagnosable rather than vanishing.
      logger.warn({
        message:
          'Failed to resolve federation signing actor for remote profile fetch; falling back to an unsigned request',
        error: error instanceof Error ? error.message : String(error)
      })
      return undefined
    })
  ])
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

  // Persist the freshly-fetched collection sizes for known actors so the
  // Mastodon API (which reads the counter rows) serves the same counts this
  // page displays. The collection helpers report 0 for both "empty" and
  // "fetch failed", so only positive values are trusted here — null preserves
  // the stored counter. Best-effort — the page renders from the live values
  // either way.
  if (persistedActor) {
    await database
      .setActorCounters({
        actorId: person.id,
        followersCount: actorFollowersResponse.followerCount || null,
        followingCount: actorFollowingResponse.followingCount || null,
        statusCount: actorPostsResponse.statusesCount || null
      })
      .catch((error) => {
        logger.warn({
          message: 'Failed to persist remote actor collection counts',
          actorId: person.id,
          error: error instanceof Error ? error.message : String(error)
        })
      })
  }

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
