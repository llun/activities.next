import {
  getPersistableActorPerson,
  getPersistableProfile
} from '@/lib/actions/utils'
import { confirmActorHandle } from '@/lib/activities/confirmActorHandle'
import { getActorCollectionCounts } from '@/lib/activities/getActorCollectionCounts'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getActorPosts } from '@/lib/activities/getActorPosts'
import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import type { ProfileFieldItem } from '@/lib/components/profile/ProfileFieldsBlock'
import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { Database } from '@/lib/database/types'
import { isUniqueConstraintError } from '@/lib/database/utils/isUniqueConstraintError'
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
import { queueProfileLinkVerification } from '@/lib/services/profile-links/queueProfileLinkVerification'
import {
  canActorReadStatus,
  resolveActorStatusesAudience
} from '@/lib/services/statusAccess'
import { overlayStoredViewerState } from '@/lib/services/statuses/overlayViewerState'
import { Actor } from '@/lib/types/activitypub'
import { Actor as DomainActor } from '@/lib/types/domain/actor'
import { Attachment, isVisualAttachment } from '@/lib/types/domain/attachment'
import { ProfileTabVisibility } from '@/lib/types/domain/profileTabs'
import { Status, StatusType } from '@/lib/types/domain/status'
import { getActorProfileFields } from '@/lib/utils/activitypubActor'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { getPersonFromActor } from '@/lib/utils/getPersonFromActor'
import { logger } from '@/lib/utils/logger'
import { formatProfileFieldValue } from '@/lib/utils/text/formatProfileFieldValue'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { VERSION } from '@/lib/utils/version'

// ISO 8601 for the profile block; a field is verified only when its stored
// verifiedAt is set.
const toVerifiedAt = (verifiedAt: number | null | undefined) =>
  verifiedAt ? getISOTimeUTC(verifiedAt) : null

type ProfileData = {
  person: Actor
  // The profile links with their verification, ready for ProfileFieldsBlock:
  // values are HTML, `verifiedAt` comes from the stored actor row.
  profileFields: ProfileFieldItem[]
  statuses: Status[]
  statusesCount: number | null
  statusPagination: {
    // A remote actor's feed pages through its outbox collection pages.
    nextPageUrl: string | null
    prevPageUrl: string | null
    // A local account's feed pages through its stored statuses with a
    // Mastodon-style `max_id` cursor instead: the last status scanned.
    nextMaxStatusId?: string | null
  }
  attachments: Attachment[]
  followingCount: number | null
  followersCount: number | null
  isInternalAccount: boolean
  hasFitnessData: boolean
  // Gallery subviews offered to this viewer. Scoped to the viewer, so the
  // tab's presence discloses nothing.
  gallerySubviews: GallerySubview[]
  // Which profile tabs the owner shows (a local actor's `showReplies`,
  // `showMedia`, `showGallery` and `showFitness` settings, each shown unless
  // set to false). Presentation only: it hides a tab, it does not protect what
  // is in it. Absent means every tab, which is what a remote profile has.
  tabVisibility?: ProfileTabVisibility
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

// Just enough of a profile to title a page about the actor and show its
// collection sizes, for the followers and following pages. It carries no
// statuses, attachments or tab flags, so it discloses nothing the actor's
// visibility rules would have to scope.
export type ProfileIdentity = Pick<
  ProfileData,
  'person' | 'followersCount' | 'followingCount' | 'isInternalAccount'
>

// The actor this server hosts under the handle, or null when the handle names
// no row or a row without an account. `getActorFromUsername` folds the
// username's case itself.
const findLocalProfileActor = async (
  database: Database,
  actorHandle: string
): Promise<DomainActor | null> => {
  const [username, domain] = actorHandle.split('@').slice(1)
  const persistedActor = await database.getActorFromUsername({
    username,
    domain
  })
  return persistedActor?.account ? persistedActor : null
}

export const getProfileData = async (
  database: Database,
  actorHandle: string,
  isLoggedIn: boolean = true,
  options: ProfileDataOptions
): Promise<ProfileData | null> => {
  const localActor = await findLocalProfileActor(database, actorHandle)
  if (localActor) {
    return getLocalProfileData(database, localActor, options)
  }
  return getRemoteProfileData(database, actorHandle, isLoggedIn, options)
}

// The followers and following pages render only the actor's name and handle
// and its follower and following counts. For a local account those come off
// the actor row `getActorFromUsername` already read, counters included (the
// same counter keys `getActorFollowersCount`/`getActorFollowingCount` read),
// so the first page of statuses, attachments, tab flags and gallery settings
// `getProfileData` loads, and the per-status visibility checks on them, are
// never asked for. Anything else takes `getProfileData`'s remote branch
// unchanged: a logged-out visitor gets null, and a signed-in one the fetched
// profile with its persistence and federation gates.
export const getProfileIdentity = async (
  database: Database,
  actorHandle: string,
  isLoggedIn: boolean,
  options: Pick<ProfileDataOptions, 'currentActor'>
): Promise<ProfileIdentity | null> => {
  const localActor = await findLocalProfileActor(database, actorHandle)
  if (localActor) {
    return {
      person: getPersonFromActor(localActor),
      followersCount: localActor.followersCount,
      followingCount: localActor.followingCount,
      isInternalAccount: true
    }
  }

  const remoteProfile = await getRemoteProfileData(
    database,
    actorHandle,
    isLoggedIn,
    options
  )
  if (!remoteProfile) return null
  return {
    person: remoteProfile.person,
    followersCount: remoteProfile.followersCount,
    followingCount: remoteProfile.followingCount,
    isInternalAccount: remoteProfile.isInternalAccount
  }
}

const getLocalProfileData = async (
  database: Database,
  persistedActor: DomainActor,
  options: ProfileDataOptions
): Promise<ProfileData> => {
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

  // A tab the owner hid is not offered to anyone, so the data behind it is not
  // queried. Posts is always shown.
  const tabVisibility: ProfileTabVisibility = {
    replies: persistedActor.showReplies !== false,
    media: persistedActor.showMedia !== false,
    gallery: persistedActor.showGallery !== false,
    fitness: persistedActor.showFitness !== false
  }

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
  // in-gallery photo on a status this viewer may read). Albums are independent
  // of the gallery switch: an album can hold photos hidden from the gallery,
  // so we check both gallery media and visible gallery albums in parallel.
  // The Gallery tab is offered to exactly the viewers who would find something
  // in it (either gallery media or visible albums).
  const galleryAudience = toGalleryAudience(audience)
  const [
    scopedStatuses,
    attachments,
    hasFitnessData,
    hasGalleryMedia,
    hasGalleryAlbums
  ] = await Promise.all([
    database.getActorStatuses({
      actorId: persistedActor.id,
      currentActorId: currentActor?.id,
      limit: PER_PAGE_LIMIT,
      ...visibilityScope
    }),
    tabVisibility.media
      ? database.getAttachmentsForActor({
          actorId: persistedActor.id,
          ...visibilityScope
        })
      : Promise.resolve([] as Attachment[]),
    tabVisibility.fitness
      ? database.getActorHasFitnessData({
          actorId: persistedActor.id,
          ...visibilityScope
        })
      : Promise.resolve(false),
    tabVisibility.gallery
      ? database.getActorHasGalleryMedia({
          actorId: persistedActor.id,
          audience: galleryAudience
        })
      : Promise.resolve(false),
    tabVisibility.gallery
      ? database.getActorHasVisibleGalleryAlbums({
          actorId: persistedActor.id,
          audience: galleryAudience
        })
      : Promise.resolve(false)
  ])

  const gallerySubviews: GallerySubview[] = []
  if (hasGalleryMedia) {
    const gallerySettings = await database.getGallerySettings({
      actorId: persistedActor.id
    })
    gallerySubviews.push('subjects', 'recent')
    if (hasGalleryAlbums) {
      gallerySubviews.push('albums')
    }
    if (audience.isOwner || gallerySettings.mapPublic) {
      gallerySubviews.push('map')
    }
    if (audience.isOwner || gallerySettings.lifeListPublic) {
      gallerySubviews.push('life-list')
    }
  } else if (hasGalleryAlbums) {
    // Albums are independent of the gallery switch: an actor with no in-gallery
    // media who curates hidden-from-gallery photos into albums still offers the
    // Gallery tab directly at Albums to any viewer who can open at least one.
    gallerySubviews.push('albums')
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
  // concurrently. Later pages come from `GET /api/v1/accounts/:id/statuses`,
  // which runs the same checks.
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
    // A local actor's stored value is the raw text; the page shows the HTML
    // the actor document carries.
    profileFields: (persistedActor.fields ?? []).map((field) => ({
      name: field.name,
      value: formatProfileFieldValue(field.value),
      verifiedAt: toVerifiedAt(field.verifiedAt)
    })),
    statuses,
    statusesCount,
    statusPagination: {
      nextPageUrl: null,
      prevPageUrl: null,
      // A full page may have more behind it. The cursor is the last status
      // scanned, not the last one kept, so statuses this viewer cannot read
      // at the end of the page are not scanned again.
      nextMaxStatusId:
        scopedStatuses.length >= PER_PAGE_LIMIT
          ? scopedStatuses[scopedStatuses.length - 1].id
          : null
    },
    attachments,
    followingCount,
    followersCount,
    isInternalAccount: true,
    hasFitnessData,
    gallerySubviews,
    tabVisibility,
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

const getRemoteProfileData = async (
  database: Database,
  actorHandle: string,
  isLoggedIn: boolean,
  options: ProfileDataOptions
): Promise<ProfileData | null> => {
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
    const persistableProfile = getPersistableProfile(persistablePerson)
    await database.updateActor({
      actorId: persistablePerson.id,
      ...persistableProfile
    })
    await queueProfileLinkVerification({
      actorId: persistablePerson.id,
      before: storedActor.fields,
      after: persistableProfile.fields,
      remote: true,
      // This runs on every render of a remote profile, and `updatedAt` moves
      // on each one, so the gate is the job's own `linksCheckedAt` stamp:
      // changed values at most hourly, unverified ones every 3 days.
      renderCheckedAt: storedActor.linksCheckedAt ?? null
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
      await queueProfileLinkVerification({
        actorId: persistablePerson.id,
        before: undefined,
        after: persistableProfile.fields,
        remote: true
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

  // The live outbox does not carry the viewer's like/bookmark state; overlay
  // what the stored rows say. With no viewer the helper returns the statuses
  // unchanged.
  const statuses = await overlayStoredViewerState({
    database,
    currentActor: options.currentActor,
    statuses: actorPostsResponse.statuses
  })

  const resolvedStatusesCount =
    collectionCounts.statusesCount ??
    actorPostsResponse.statusesCount ??
    (statuses.length > 0 ? statuses.length : null)

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
    statuses,
    person,
    // The live document's fields, with the verification of the stored row's
    // field of the same name and value (a changed value is not verified).
    profileFields: getActorProfileFields(person).map((field) => ({
      ...field,
      verifiedAt: toVerifiedAt(
        storedActor?.fields?.find(
          (stored) =>
            stored.name === field.name &&
            stored.value === field.value &&
            stored.verifiedAt
        )?.verifiedAt
      )
    })),
    statusesCount: resolvedStatusesCount,
    statusPagination: {
      nextPageUrl: actorPostsResponse.nextPageUrl ?? null,
      prevPageUrl: actorPostsResponse.prevPageUrl ?? null
    },
    attachments:
      attachments.length > 0
        ? attachments
        : statuses
            .flatMap((status) =>
              status.type === StatusType.enum.Note ? status.attachments : []
            )
            .filter(isVisualAttachment),
    followingCount: collectionCounts.followingCount,
    followersCount: collectionCounts.followersCount,
    isInternalAccount: false,
    hasFitnessData: false,
    // Galleries exist only for local actors.
    gallerySubviews: [],
    isPixelfed,
    isPeerTube,
    isMediaService,
    isMediaOnly,
    serverSoftware
  }
}
