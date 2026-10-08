import {
  getPersistableActorPerson,
  getPersistableProfile
} from '@/lib/actions/utils'
import { confirmActorHandle } from '@/lib/activities/confirmActorHandle'
import { getActorCollectionCounts } from '@/lib/activities/getActorCollectionCounts'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getActorPosts } from '@/lib/activities/getActorPosts'
import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import { isUniqueConstraintError } from '@/lib/database/sql/utils/isUniqueConstraintError'
import { Database } from '@/lib/database/types'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActorSafe } from '@/lib/services/federation/getFederationSigningActor'
import {
  ServerSoftware,
  getServerSoftwareInfo,
  isPeerTubeActor,
  isPixelfedActor
} from '@/lib/services/federation/serverSoftware'
import { toGalleryAudience } from '@/lib/services/gallery/galleryAudience'
import { GallerySubview } from '@/lib/services/gallery/galleryEntities'
import {
  canActorReadStatus,
  resolveActorStatusesAudience
} from '@/lib/services/statusAccess'
import { Actor } from '@/lib/types/activitypub'
import { Actor as DomainActor } from '@/lib/types/domain/actor'
import { Attachment, isVisualAttachment } from '@/lib/types/domain/attachment'
import { Status, StatusType } from '@/lib/types/domain/status'
import { getPersonFromActor } from '@/lib/utils/getPersonFromActor'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { VERSION } from '@/lib/utils/version'

type ProfileData = {
  person: Actor
  statuses: Status[]
  statusesCount: number | null
  statusPagination: {
    nextPageUrl: string | null
    prevPageUrl: string | null
  }
  attachments: Attachment[]
  followingCount: number | null
  followersCount: number | null
  isInternalAccount: boolean
  hasFitnessData: boolean
  // Whether the profile shows a Gallery tab, and which subviews it offers.
  // Both are scoped to the viewer, so the tab's presence discloses nothing.
  hasGalleryMedia: boolean
  gallerySubviews: GallerySubview[]
  isPixelfed?: boolean
  isPeerTube?: boolean
  isMediaService?: boolean
  serverSoftware?: ServerSoftware | null
  isMediaOnly?: boolean
}

type ProfileDataOptions = {
  statusPageUrl?: string
  // The signed-in viewer, explicitly `null` when logged out. This drives BOTH
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
  //
  // REQUIRED, and the options object with it: an optional viewer is what let a
  // page omit it and silently serve every visitor the logged-out view — the
  // original bug, at the one call site that mattered. A caller with no viewer
  // must now say `null` rather than say nothing, which the compiler checks at
  // every call site, including ones a lint or test-time scan would never see.
  currentActor: DomainActor | null
}

export const getProfileData = async (
  database: Database,
  actorHandle: string,
  isLoggedIn: boolean = true,
  options: ProfileDataOptions
): Promise<ProfileData | null> => {
  const [username, domain] = actorHandle.split('@').slice(1)
  const persistedActor = await database.getActorFromUsername({
    username,
    domain
  })

  if (persistedActor?.account) {
    const currentActor = options.currentActor

    // Only the statuses and attachments queries are scoped by the viewer, so
    // the audience lookup runs alongside the counts rather than in front
    // of them — for a signed-in non-owner it costs a follow query, and making
    // the whole fan-out wait on it would add that latency to a hot page.
    const [audience, statusesCount, followingCount, followersCount] =
      await Promise.all([
        resolveActorStatusesAudience({
          database,
          targetActor: persistedActor,
          currentActor
        }),
        database.getActorStatusesCount({ actorId: persistedActor.id }),
        database.getActorFollowingCount({ actorId: persistedActor.id }),
        database.getActorFollowersCount({ actorId: persistedActor.id })
      ])

    const visibilityScope = {
      publicOnly: audience.publicOnly,
      visibleToActorId: audience.visibleToActorId,
      includeFollowersOnly: audience.includeFollowersOnly,
      followersAudience: audience.followersAudience
    }

    // Scoped by the same audience as the statuses and attachments: whether the
    // Fitness tab exists is itself a disclosure, so a viewer who cannot read
    // any of this actor's fitness posts must not be told there are any. The
    // owner's audience carries no filter, which keeps their own tab unchanged.
    // The gallery asks the same question through its own scope (a posted,
    // in-gallery photo on a status this viewer may read), so the Gallery tab
    // is offered to exactly the viewers who would find something in it.
    const [scopedStatuses, attachments, hasFitnessData, hasGalleryMedia] =
      await Promise.all([
        database.getActorStatuses({
          actorId: persistedActor.id,
          currentActorId: currentActor?.id,
          ...visibilityScope
        }),
        database.getAttachmentsForActor({
          actorId: persistedActor.id,
          ...visibilityScope
        }),
        database.getActorHasFitnessData({
          actorId: persistedActor.id,
          ...visibilityScope
        }),
        database.getActorHasGalleryMedia({
          actorId: persistedActor.id,
          audience: toGalleryAudience(audience)
        })
      ])

    const gallerySubviews: GallerySubview[] = []
    if (hasGalleryMedia) {
      const gallerySettings = await database.getGallerySettings({
        actorId: persistedActor.id
      })
      gallerySubviews.push('subjects', 'recent')
      if (audience.isOwner || gallerySettings.mapPublic) {
        gallerySubviews.push('map')
      }
      if (audience.isOwner || gallerySettings.lifeListPublic) {
        gallerySubviews.push('life-list')
      }
    }

    // The SQL scope above filters on the status's own recipients, which cannot
    // see through a boost: an Announce is public while the status it boosts may
    // not be. `canActorReadStatus` follows that chain and is the authority,
    // pairing a narrowed query with a per-status check the way
    // `GET /api/v1/accounts/:id/statuses` and the outbox route do.
    //
    // `isFollower` covers this actor's own statuses. A boosted original belongs
    // to someone else, so its follow state is looked up per status rather than
    // prefetched into the `followerStateByActorId` map the statuses route
    // builds — that route scans repeatedly and reuses the map across batches,
    // where this renders one page. Bounded by page size and issued
    // concurrently; revisit if a profile page ever pages server-side.
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
      hasFitnessData,
      hasGalleryMedia,
      gallerySubviews,
      isPixelfed: false,
      isPeerTube: false,
      isMediaService: false,
      serverSoftware: {
        name: 'activities.next',
        version: VERSION
      },
      isMediaOnly: false
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

  // Don't fetch or persist actors from domains this instance won't federate
  // with. Without this gate a hot profile render would search-index and store
  // an actor from a blocked or (in allowlist mode) non-allowlisted domain. The
  // WebFinger-resolved id decides federation policy, and it is re-checked
  // against `person.id` below because that id — the server's own choice of
  // canonical id — can name a different host.
  if (!(await canFederateWithDomain(database, actorId))) return null

  const signingParams = signingActor ? { signingActor } : {}
  const person = await getActorPerson({ actorId, ...signingParams })
  if (!person) return null

  // The id actually written is `person.id`, not the WebFinger id, so the
  // federation gate is applied again to the id we persist and index — a
  // split-domain deployment answers WebFinger for `@llun@llun.dev` with a
  // Person whose id lives on `social.llun.dev`, so the two hosts differ.
  if (!(await canFederateWithDomain(database, person.id))) return null

  // Look up the row by the id we are about to write (`person.id`), NOT by the
  // handle `persistedActor` was resolved from. On a split-domain deployment the
  // handle (`llun@llun.dev`) and the stored id's host (`social.llun.dev`)
  // differ, so `getActorFromUsername` misses forever while the row already
  // exists under `person.id`. Keying the update/create decision on the handle
  // therefore re-entered the create branch on every render and re-inserted the
  // same id — a permanent 500 on the `actors_id_unique` constraint.
  const storedActor = await database.getActorFromId({ id: person.id })
  // Never write a LOCAL actor's row from fetched data. `getActorPerson` binds
  // `person.id` to the origin that served it, so a hostile WebFinger target can
  // no longer name our ids — but a handle whose WebFinger resolves back to this
  // instance still lands here, and a local row's key, inboxes, profile and
  // counters are owned by its account, not by whatever a fetch returned.
  // Mirrors recordActorIfNeeded's "Don't update local actor".
  const isLocalActor = Boolean(storedActor?.privateKey || storedActor?.account)
  // The WebFinger `self` link is not bound to the handle's domain (split-domain
  // deployments need it unbound), so it can name ANY URL — a same-origin user
  // upload whose JSON claims another actor's id with its own key and inbox.
  // Only a document fetched from its own id is written as-is, the same rule
  // recordActorIfNeeded applies: a row already stored under a different
  // `person.id` is left untouched, and a new one is created only from what
  // `person.id` itself serves. The page still renders the fetched document.
  let persistablePerson: Actor | null = null
  if (isLocalActor) {
    // Read-only render of our own actor reached through a remote handle.
  } else if (person.id === actorId) {
    persistablePerson = person
  } else if (!storedActor) {
    persistablePerson = await getPersistableActorPerson({
      requestedActorId: actorId,
      person,
      ...signingParams
    })
  }
  // A new row fixes `username@domain` for good, and the `self` link above came
  // from the handle's domain, which need not be the actor's: a hostile
  // `@x@evil.example` can point it at any URL on any host. WebFinger must
  // confirm the handle the row is stored under before the row exists.
  const handle =
    persistablePerson && !storedActor
      ? await confirmActorHandle({
          database,
          actorId: persistablePerson.id,
          username: persistablePerson.preferredUsername,
          webfinger: persistablePerson.webfinger
        })
      : null
  if (!storedActor && !handle) {
    persistablePerson = null
  }
  if (persistablePerson && storedActor) {
    // Same field set recordActorIfNeeded persists, so the web profile page
    // and the Mastodon API refresh paths write consistent snapshots (including
    // metadata fields and the locked state).
    await database.updateActor({
      actorId: persistablePerson.id,
      ...getPersistableProfile(persistablePerson)
    })
  } else if (persistablePerson && handle) {
    const persistableProfile = getPersistableProfile(persistablePerson)
    // A concurrent render can insert the same id between the read above and
    // this insert. Rather than serialize the whole render, treat the unique
    // violation as "someone else won the race" and fall back to the update the
    // winner's row now needs — any other error is real and rethrown.
    try {
      await database.createActor({
        actorId: persistablePerson.id,
        username: handle.username,
        domain: handle.domain,
        ...persistableProfile,
        createdAt: new Date(persistablePerson.published ?? Date.now()).getTime()
      })
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      await database.updateActor({
        actorId: persistablePerson.id,
        ...persistableProfile
      })
    }
  }

  // A remote actor's attachments are the ones their statuses brought here when
  // they federated in, which includes followers-only posts delivered to a local
  // follower. Scope this gallery the same way the local branch above scopes its
  // own. `getActorPosts` reads the remote outbox signed by the instance actor
  // and returns only its public and unlisted notes (a server may hand a
  // follower signer more), so only the attachment query needs scoping here.
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

  let remoteDomain: string | null = null
  try {
    remoteDomain = new URL(person.id).host
  } catch {
    // Malformed person.id
  }

  const [actorPostsResponse, attachments, collectionCounts, serverSoftware] =
    await Promise.all([
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
      getActorCollectionCounts({ person, ...signingParams }),
      remoteDomain ? getServerSoftwareInfo(remoteDomain) : Promise.resolve(null)
    ])

  const resolvedStatusesCount =
    collectionCounts.statusesCount ??
    actorPostsResponse.statusesCount ??
    (actorPostsResponse.statuses.length > 0
      ? actorPostsResponse.statuses.length
      : null)

  // Persist the freshly-fetched collection sizes for known actors so the
  // Mastodon API (which reads the counter rows) serves the same counts this
  // page displays. getActorCollectionCounts distinguishes a fetch failure
  // (null, preserves the stored counter) from a real zero.
  // Best-effort — the page renders from the live values either way. The counts
  // come from the fetched document's collections, so they are written only when
  // that document was itself persisted (fetched from its own id).
  try {
    if (persistablePerson === person) {
      await database.setActorCounters({
        actorId: person.id,
        followersCount: collectionCounts.followersCount,
        followingCount: collectionCounts.followingCount,
        statusCount: resolvedStatusesCount
      })
    }
  } catch (error) {
    logger.warn({
      message: 'Failed to persist remote actor collection counts',
      actorId: person.id,
      err: toLoggableError(error)
    })
  }

  const isPixelfed =
    serverSoftware?.name === 'pixelfed' || (await isPixelfedActor(person))
  const isPeerTube =
    serverSoftware?.name === 'peertube' || (await isPeerTubeActor(person))
  const isMediaService = isPixelfed || isPeerTube
  const isMediaOnly = isMediaService

  return {
    ...actorPostsResponse,
    person,
    statusesCount: resolvedStatusesCount,
    statusPagination: {
      nextPageUrl: actorPostsResponse.nextPageUrl ?? null,
      prevPageUrl: actorPostsResponse.prevPageUrl ?? null
    },
    attachments:
      attachments.length > 0
        ? attachments
        : actorPostsResponse.statuses
            .flatMap((status) =>
              status.type === StatusType.enum.Note ? status.attachments : []
            )
            .filter(isVisualAttachment),
    followingCount: collectionCounts.followingCount,
    followersCount: collectionCounts.followersCount,
    isInternalAccount: false,
    hasFitnessData: false,
    // Galleries exist only for local actors.
    hasGalleryMedia: false,
    gallerySubviews: [],
    isPixelfed,
    isPeerTube,
    isMediaService,
    isMediaOnly,
    serverSoftware
  }
}
