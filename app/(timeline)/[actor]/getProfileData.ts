import { getPersistableProfile } from '@/lib/actions/utils'
import { getActorCollectionCounts } from '@/lib/activities/getActorCollectionCounts'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getActorPosts } from '@/lib/activities/getActorPosts'
import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import { Database } from '@/lib/database/types'
import { getFederationSigningActorSafe } from '@/lib/services/federation/getFederationSigningActor'
import {
  canActorReadStatus,
  resolveActorStatusesAudience
} from '@/lib/services/statusAccess'
import { Actor } from '@/lib/types/activitypub'
import { Actor as DomainActor } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import { Status } from '@/lib/types/domain/status'
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
  // The signed-in viewer, or null/undefined when logged out. This drives BOTH
  // halves of what a profile serves: hydration (the like/bookmark/reaction state
  // carried on the returned statuses) and, through
  // `resolveActorStatusesAudience`, which statuses and attachments are returned
  // at all.
  //
  // It takes the whole actor rather than an id because both halves are needed
  // and an id alone cannot answer the second. The previous `currentActorId`
  // spelling could only hydrate, so the local-account branch below queried with
  // no visibility filter and served followers-only posts, direct messages and
  // their attachments to logged-out visitors.
  currentActor?: DomainActor | null
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
    const currentActor = options.currentActor ?? null
    // Which of this actor's posts (and their attachments) this viewer is
    // allowed to be shown. Resolved before the fan-out below because every
    // query in it is scoped by the answer.
    const audience = await resolveActorStatusesAudience({
      database,
      targetActor: persistedActor,
      currentActor
    })
    const visibilityScope = {
      publicOnly: audience.publicOnly,
      visibleToActorId: audience.visibleToActorId,
      includeFollowersOnly: audience.includeFollowersOnly,
      followersAudience: audience.followersAudience
    }

    const [
      scopedStatuses,
      statusesCount,
      attachments,
      followingCount,
      followersCount,
      hasFitnessData
    ] = await Promise.all([
      database.getActorStatuses({
        actorId: persistedActor.id,
        currentActorId: currentActor?.id,
        ...visibilityScope
      }),
      database.getActorStatusesCount({ actorId: persistedActor.id }),
      database.getAttachmentsForActor({
        actorId: persistedActor.id,
        ...visibilityScope
      }),
      database.getActorFollowingCount({ actorId: persistedActor.id }),
      database.getActorFollowersCount({ actorId: persistedActor.id }),
      database.getActorHasFitnessData({ actorId: persistedActor.id })
    ])

    // The SQL scope above filters on the status's own recipients, which cannot
    // see through a boost: an Announce is public while the status it boosts may
    // not be. `canActorReadStatus` follows that chain and is the authority, the
    // same way `GET /api/v1/accounts/:id/statuses` and the outbox route pair a
    // narrowed query with a per-status check.
    const statuses = (
      await Promise.all(
        scopedStatuses.map(async (status) =>
          (await canActorReadStatus({
            database,
            status,
            currentActor,
            isFollower: audience.isFollower
          }))
            ? status
            : null
        )
      )
    ).filter((status): status is Status => status !== null)

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
  // federation jobs and relay/follow flows; without it, secure-mode remote
  // profiles 404. Resolution is best-effort and degrades to an unsigned fetch.
  //
  // WebFinger discovery and signer resolution are independent, so resolve them
  // concurrently to avoid stacking their latencies on the profile render.
  const [actorId, signingActor] = await Promise.all([
    getWebfingerSelf({ account: actorHandle.slice(1) }),
    getFederationSigningActorSafe(database, 'for remote profile fetch')
  ])
  if (!actorId) return null

  const signingParams = signingActor ? { signingActor } : {}
  const person = await getActorPerson({ actorId, ...signingParams })
  if (!person) return null

  if (persistedActor) {
    // Same field set recordActorIfNeeded persists, so the web profile page
    // and the Mastodon API refresh paths write consistent snapshots (including
    // metadata fields and the locked state).
    await database.updateActor({
      actorId: person.id,
      ...getPersistableProfile(person)
    })
  }

  // A remote actor's attachments are the ones their statuses brought here when
  // they federated in, which includes followers-only posts delivered to a local
  // follower. Scope this gallery the same way the local branch above scopes its
  // own — `getActorPosts` reads the remote outbox, which is public by
  // construction, so only the attachment query needs it.
  const remoteAudience = await resolveActorStatusesAudience({
    database,
    targetActor: { id: person.id, followersUrl: person.followers },
    currentActor: options.currentActor
  })
  const remoteVisibilityScope = {
    publicOnly: remoteAudience.publicOnly,
    visibleToActorId: remoteAudience.visibleToActorId,
    includeFollowersOnly: remoteAudience.includeFollowersOnly,
    followersAudience: remoteAudience.followersAudience
  }

  const [actorPostsResponse, attachments, collectionCounts] = await Promise.all(
    [
      getActorPosts({
        database,
        person,
        pageUrl: options.statusPageUrl,
        ...signingParams
      }),
      database.getAttachmentsForActor({
        actorId: person.id,
        ...remoteVisibilityScope
      }),
      getActorCollectionCounts({ person, ...signingParams })
    ]
  )

  // Persist the freshly-fetched collection sizes for known actors so the
  // Mastodon API (which reads the counter rows) serves the same counts this
  // page displays. getActorCollectionCounts distinguishes a fetch failure
  // (null, preserves the stored counter) from a real zero. getActorPosts
  // reports 0 for both, so only positive status counts are trusted here.
  // Best-effort — the page renders from the live values either way.
  if (persistedActor) {
    await database
      .setActorCounters({
        actorId: person.id,
        followersCount: collectionCounts.followersCount,
        followingCount: collectionCounts.followingCount,
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
    followingCount: collectionCounts.followingCount ?? 0,
    followersCount: collectionCounts.followersCount ?? 0,
    isInternalAccount: false,
    hasFitnessData: false
  }
}
