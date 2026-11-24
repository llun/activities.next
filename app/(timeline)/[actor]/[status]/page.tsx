import { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { FC } from 'react'

import { MobileCompactHeader } from '@/lib/components/layout/mobile-compact-header'
import { profileName } from '@/lib/components/navigation-history/backDestination'
import {
  MOBILE_FEED_SURFACE_CLASS,
  MOBILE_INSET_CARD_CLASS,
  MOBILE_INSET_CARD_FRAME_CLASS,
  MOBILE_INSET_STACK_CLASS,
  POST_LIST_FRAME_CLASS
} from '@/lib/components/posts/feedLayout'
import { getBaseURL, getConfig } from '@/lib/config'
import { getPublicMapProvider } from '@/lib/config/mapProvider'
import { getDatabase } from '@/lib/database'
import { FETCH_REMOTE_STATUS_JOB_NAME } from '@/lib/jobs/names'
import { loadBlueskyThread } from '@/lib/services/bluesky/thread'
import { getDomainDisplayName } from '@/lib/services/domains/domainDisplayName'
import { getVisitedDomainIdentity } from '@/lib/services/domains/domainIdentity'
import { getServedHostConfig } from '@/lib/services/domains/servedDomainSnapshot'
import { getVisitedSignUpDomain } from '@/lib/services/domains/visitedSignUpDomain'
import {
  canFederateWithDomain,
  isLocalFederationDomain
} from '@/lib/services/federation/domainPolicy'
import { FederationPolicyUnavailableError } from '@/lib/services/federation/policyUnavailable'
import { getPersonalRecordDurations } from '@/lib/services/fitness-files/personalRecords'
import { getStatusFitnessFiles } from '@/lib/services/fitness-files/statusFitnessFiles'
import { getTrainingZoneSettings } from '@/lib/services/fitness-files/trainingZoneSettings'
import { resolveSessionActor } from '@/lib/services/guards/sessionActor'
import { enrichStatusAttachments } from '@/lib/services/medias/animationMetadata'
import { getQueue } from '@/lib/services/queue'
import {
  canActorReadStatus,
  isStatusPubliclyReadable
} from '@/lib/services/statusAccess'
import {
  fetchEphemeralRemoteStatus,
  isUrl
} from '@/lib/services/statuses/fetchEphemeralRemoteStatus'
import { getStatusContext } from '@/lib/services/statuses/getStatusContext'
import { queueThreadGapBackfill } from '@/lib/services/statuses/parentBackfill'
import {
  THREAD_INITIAL_ANCESTORS_LIMIT,
  THREAD_INITIAL_DESCENDANTS_LIMIT
} from '@/lib/services/statuses/threadPageLimits'
import { getActorProfile } from '@/lib/types/domain/actor'
import {
  Status,
  StatusType,
  getOriginalStatus,
  isBlueskyStatus
} from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'
import { isBlueskyId } from '@/lib/utils/blueskyId'
import { cleanJson } from '@/lib/utils/cleanJson'
import { getActorMentionPathSegment } from '@/lib/utils/getActorMentionPathSegment'
import { getStatusDetailPath } from '@/lib/utils/getStatusDetailPath'
import { getStatusVisibility } from '@/lib/utils/getVisibility'
import { getCanonicalAuthority, isOwnInstanceHost } from '@/lib/utils/host'
import { logger } from '@/lib/utils/logger'
import { htmlToPlainText } from '@/lib/utils/text/htmlToPlainText'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import { Header } from './Header'
import { PagedStatusThread } from './PagedStatusThread'
import { RemoteStatusLoading } from './RemoteStatusLoading'
import { SignInCallout } from './SignInCallout'
import { StatusBox } from './StatusBox'
import { StatusLikes } from './StatusLikes'
import { decodePathParam, resolveStatusFromPath } from './resolveStatusFromPath'
import { statusMatchesPathActor } from './statusPathActor'

interface Props {
  params: Promise<{ actor: string; status: string }>
}

const isStatusStrictlyPublic = (status: Status): boolean => {
  if (status.type === StatusType.enum.Announce) {
    return (
      getStatusVisibility(status) === 'public' &&
      getStatusVisibility(status.originalStatus) === 'public'
    )
  }
  return getStatusVisibility(status) === 'public'
}

const isLocalActorHandleDomain = (
  actorDomain: string,
  baseHost: string
): boolean => {
  const canonicalActorDomain = getCanonicalAuthority(actorDomain)
  if (!canonicalActorDomain) return false
  if (baseHost && getCanonicalAuthority(baseHost) === canonicalActorDomain) {
    return true
  }
  try {
    const config = getConfig()
    if (!config) return false
    if (isOwnInstanceHost(actorDomain, getServedHostConfig(config))) {
      return true
    }
    return (config.allowActorDomains ?? []).some(
      (domain) => getCanonicalAuthority(domain) === canonicalActorDomain
    )
  } catch {
    return false
  }
}

const getCanonicalStatusUrl = (
  actualStatus: NonNullable<ReturnType<typeof getOriginalStatus>>,
  fallbackUrl: string
): { canonicalUrl: string; isRemote: boolean } => {
  if (actualStatus.isLocalActor === false) {
    const remoteUrl =
      'url' in actualStatus && actualStatus.url
        ? actualStatus.url
        : actualStatus.id
    return {
      canonicalUrl: remoteUrl || fallbackUrl,
      isRemote: true
    }
  }

  const detailPath = getStatusDetailPath(actualStatus)
  return {
    canonicalUrl: detailPath ? `${getBaseURL()}${detailPath}` : fallbackUrl,
    isRemote: false
  }
}

const getAuthorCanonicalUrl = (
  actualStatus: NonNullable<ReturnType<typeof getOriginalStatus>>,
  fallbackHref: string
): string => {
  if (!actualStatus.actor) {
    return `${getBaseURL()}${fallbackHref}`
  }

  if (actualStatus.isLocalActor === false) {
    return actualStatus.actor.id
  }

  return `${getBaseURL()}/${getActorMentionPathSegment(actualStatus.actor)}`
}

export const generateMetadata = async ({
  params
}: Props): Promise<Metadata> => {
  const { actor, status } = await params
  const decodedActor = decodePathParam(actor)
  const baseUrl = getBaseURL()
  // Deterministically re-encoded page URL: the status segment can itself be a
  // full remote status URL, so each segment is percent-encoded to survive the
  // round-trip through the oEmbed endpoint's URL parser.
  const pageUrl = `${baseUrl}/${encodeURIComponent(decodedActor)}/${encodeURIComponent(decodePathParam(status))}`

  const baseHost = (() => {
    try {
      return new URL(baseUrl).host.toLowerCase()
    } catch {
      return ''
    }
  })()
  const actorDomainMatch = decodedActor.match(/^@?[^@]+@([^/@]+)$/)
  const actorDomain = actorDomainMatch?.[1]?.toLowerCase()
  const isRemoteActorHandle = Boolean(
    actorDomain && baseHost && !isLocalActorHandleDomain(actorDomain, baseHost)
  )

  const siteName = getDomainDisplayName(await getVisitedDomainIdentity())
  let description = `View ${decodedActor}'s post on ${siteName}`
  let canonicalUrl: string | undefined = isRemoteActorHandle
    ? undefined
    : pageUrl
  let shouldNoIndex = isRemoteActorHandle
  const database = getDatabase()
  let shouldNotFound = false
  if (database) {
    try {
      const resolved = await resolveStatusFromPath({
        database,
        actorParam: actor,
        statusParam: status
      })
      if (
        resolved?.status &&
        isStatusPubliclyReadable(resolved.status) &&
        !(await statusMatchesPathActor({
          database,
          status: resolved.status,
          pathActor: resolved.pathActor
        }))
      ) {
        // A status may only be unfurled under the actor its path names, so a
        // local handle is never paired with foreign content. Only a publicly
        // readable status may 404 here: a non-public one has to answer exactly
        // like an unstored one, or the 404 would tell a stranger that a private
        // status URI is stored and who wrote it.
        shouldNotFound = true
      } else if (resolved?.status && isBlueskyStatus(resolved.status)) {
        // Bluesky posts are shown to signed-in viewers only: never indexed,
        // and no text in the description.
        canonicalUrl = undefined
        shouldNoIndex = true
      } else if (resolved?.status && isStatusStrictlyPublic(resolved.status)) {
        const actualStatus = getOriginalStatus(resolved.status)
        if (actualStatus) {
          const resolvedCanonical = getCanonicalStatusUrl(actualStatus, pageUrl)
          canonicalUrl = resolvedCanonical.canonicalUrl
          shouldNoIndex = resolvedCanonical.isRemote

          if (actualStatus.type === StatusType.enum.Note) {
            const text = actualStatus.summary || actualStatus.text
            if (text) {
              const cleanText = htmlToPlainText(text)
              if (cleanText) {
                description = cleanText.slice(0, 160)
              }
            }
          }
        }
      } else if (resolved) {
        canonicalUrl = undefined
        shouldNoIndex = true
      }
    } catch {
      // Best-effort description fallback
    }
  }
  if (shouldNotFound) notFound()

  return {
    title: `${decodedActor} status`,
    description,
    ...(shouldNoIndex ? { robots: { index: false, follow: false } } : {}),
    alternates: {
      ...(canonicalUrl ? { canonical: canonicalUrl } : {}),
      types: {
        // oEmbed discovery link (https://oembed.com/#section4): consumers read
        // <link rel="alternate" type="application/json+oembed"> from the
        // public status page to find GET /api/oembed.
        'application/json+oembed': `${baseUrl}/api/oembed?url=${encodeURIComponent(pageUrl)}`
      }
    }
  }
}

const Page: FC<Props> = async ({ params }) => {
  // The per-request nonce proxy.ts puts on the request, for the JSON-LD blocks
  // below. Next tags its own scripts with it automatically.
  const nonce = (await headers()).get('x-nonce') ?? undefined
  const config = getConfig()
  const { host, mediaStorage } = config
  const mapProvider = getPublicMapProvider()
  const database = getDatabase()
  if (!database) throw new Error('Database is not available')
  const { open: registrationOpen } = await getVisitedSignUpDomain(database)

  // A suspended actor or a disabled/unconfirmed account is treated exactly like
  // an anonymous visitor: no remote-fetch queueing and no non-public reads. A
  // credential must never make a public read worse than sending none (the
  // OptionalOAuthGuard `unconfirmedAccount: 'anonymous'` disposition).
  const resolved = await resolveSessionActor(database)
  const currentActor = resolved.type === 'actor' ? resolved.actor : null
  const session = resolved.type === 'actor' ? resolved.session : null
  const currentActorProfile = currentActor
    ? getActorProfile(currentActor)
    : null

  const { actor, status: statusParam } = await params
  const currentTime = Date.now()
  const resolvedStatus = await resolveStatusFromPath({
    database,
    actorParam: actor,
    statusParam,
    currentActorId: currentActor?.id
  })
  if (!resolvedStatus) return notFound()

  const { fullStatusId, isStatusHash, pathActor } = resolvedStatus
  let { status, statusId } = resolvedStatus
  // Only a status read from our own database may have its attachment metadata
  // written back. A live-fetched one is the remote server's claim: its
  // attachment ids are whatever the document says, and persisting against
  // them would let any remote note rewrite another status's attachment rows.
  const isStoredStatus = Boolean(status)

  let canFetchRemote = false
  if (!status && !isStatusHash && fullStatusId) {
    try {
      // A Bluesky post is never an ActivityPub fetch: unstored, it 404s.
      canFetchRemote =
        isUrl(fullStatusId) &&
        !isBlueskyId(fullStatusId) &&
        !(await isLocalFederationDomain(database, fullStatusId)) &&
        (await canFederateWithDomain(database, fullStatusId))

      if (canFetchRemote) {
        // Route live fetches through fetchEphemeralRemoteStatus so federation
        // policy, local-domain refusal, same-origin id/attribution checks, and
        // public/unlisted audience gating run before hydrating the author.
        // Anonymous visitors hydrate the author in memory only: this page is a
        // read-only view and must not record actors, sync counts or queue jobs.
        status = await fetchEphemeralRemoteStatus({
          database,
          statusId: fullStatusId,
          persistActor: Boolean(session)
        })
        statusId = status?.id ?? ''
      }
    } catch (error) {
      if (!(error instanceof FederationPolicyUnavailableError)) throw error
      // The federation policy could not be decided. Skip the live fetch rather
      // than answer 500: a signed-in viewer sees the loading state and queues
      // the fetch job below, an anonymous visitor gets a 404. A URL on this
      // instance is never queued.
      status = null
      // A Bluesky id never reaches here: its check above returns before
      // anything that can throw.
      canFetchRemote = !isOwnInstanceHost(
        new URL(fullStatusId).host,
        getServedHostConfig(config)
      )
    }
  }

  if (status) {
    // Bluesky posts are shown to signed-in viewers only; a signed-out visitor
    // is sent to the post on bsky.app. A local boost row of a Bluesky post is
    // not itself a bsky.app post, so it falls through to canActorReadStatus
    // and 404s instead of redirecting.
    if (
      !currentActor &&
      status.type !== StatusType.enum.Announce &&
      isBlueskyStatus(status)
    ) {
      return isBlueskyId(status.id) ? redirect(status.id) : notFound()
    }

    // Focused-status visibility gate — the single source of truth shared with the
    // ancestor chain below. `canActorReadStatus` collapses to the public/unlisted
    // check for logged-out visitors and, for an Announce, recurses into the
    // boosted status, so a public boost of a followers-only post is rejected
    // unless the viewer follows the boosted author. It also exact-matches the
    // author's stored `followersUrl` (rather than a loose `/followers` suffix), so
    // a remote follower of a followers-only post is no longer misread as a
    // direct-message non-recipient. Gating here, before the path-actor redirect
    // and the reply fetch, rejects unreadable statuses for every viewer up front
    // and keeps a private or direct status's author and canonical id out of the
    // redirect a viewer who cannot read it would otherwise receive.
    if (!(await canActorReadStatus({ database, status, currentActor }))) {
      return notFound()
    }

    // A status may only render under the actor its path names: its actor id is
    // compared with the path actor's stored id, or, when the path actor is not
    // stored, with the verified handle. A mismatch redirects to the canonical
    // path (or 404s when none can be built), so a local name is never paired
    // with foreign content.
    if (!(await statusMatchesPathActor({ database, status, pathActor }))) {
      // A live fetch that answers with a different id than the one requested can
      // answer the same way from the path a redirect would send the viewer to,
      // so two inconsistent remote aliases would loop. 404 instead of
      // redirecting; a stored row's id is stable, so its redirect cannot.
      if (!isStoredStatus && status.id !== fullStatusId) {
        return notFound()
      }
      const canonicalPath = getStatusDetailPath(status)
      if (canonicalPath) {
        // A redirect to the path the viewer is already on would loop: the same
        // request resolves the same way and redirects again. That happens when
        // the path names the status's own author but the stored row for that
        // handle is another actor (a stale row or a case-variant twin), so the
        // canonical path is the current one. 404 instead of redirecting.
        const canonicalSegments = canonicalPath.split('/').filter(Boolean)
        if (
          canonicalSegments.length === 2 &&
          decodePathParam(canonicalSegments[0]) === decodePathParam(actor) &&
          decodePathParam(canonicalSegments[1]) === decodePathParam(statusParam)
        ) {
          return notFound()
        }
        redirect(canonicalPath)
      }
      return notFound()
    }

    // A live-fetched remote status carries no replies (`fromNote` sets
    // `replies: []`) and its thread is not in our database yet, so a signed-in
    // viewer would see an empty reply list. Queue the fetch job to persist the
    // status plus its reply thread. Because the job persists the focused status,
    // later views resolve it from the database and skip this branch entirely —
    // bounding repeat fetches for popular posts.
    if (!isStoredStatus && status.type === StatusType.enum.Note && session) {
      // A queue failure (service down, rate limited) must not 500 the page —
      // the live-fetched status is still renderable, so log and continue.
      try {
        const queue = getQueue()
        // Under the in-process NoQueue, `publish` runs the job inline and we
        // await it here, so keep that run to the focused note's direct replies
        // (`firstPageOnly`) — they're stored before the query below and show on
        // this render without a large nested walk blocking it. A real queue runs
        // the full thread out of band, appearing on a later view.
        await queue.publish({
          id: `fetch-remote-status-${fullStatusId}`,
          name: FETCH_REMOTE_STATUS_JOB_NAME,
          data: { statusId: fullStatusId, firstPageOnly: queue.runsInline }
        })
      } catch (error) {
        logger.error(
          `[status page] Failed to queue remote reply fetch: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      }
    }
  }

  // Try to fetch remote status if not found and user is logged in. An empty
  // `fullStatusId` means there is nothing to fetch — a local path or a stored
  // candidate the path actor does not own — so fall through to the 404 instead
  // of queueing a job for an empty id and showing the loading state forever.
  if (!status && session && !isStatusHash && fullStatusId && canFetchRemote) {
    const queue = getQueue()
    // Queue the fetch job with a deterministic ID to avoid duplicates. As above,
    // an inline NoQueue run is kept to the focused note's direct replies so the
    // awaited call stays fast; a real queue walks the full thread out of band.
    // As above, a queue (or inline job) failure must not 500 the page: the
    // loading state below is still the right answer.
    try {
      await queue.publish({
        id: `fetch-remote-status-${fullStatusId}`,
        name: FETCH_REMOTE_STATUS_JOB_NAME,
        data: { statusId: fullStatusId, firstPageOnly: queue.runsInline }
      })
    } catch (error) {
      logger.warn({
        message: 'Failed to queue a remote status fetch',
        err: toLoggableError(error)
      })
    }

    // Show loading state. Its own "Fetching remote status" heading stays the
    // page's h1, so the mobile bar only names the page.
    return (
      <>
        <MobileCompactHeader title="Post" as="p" />
        <RemoteStatusLoading />
      </>
    )
  }

  if (!status) {
    return notFound()
  }

  const actualStatus = getOriginalStatus(status)
  if (actualStatus && actualStatus.type === StatusType.enum.Note) {
    // Only a signed-in view may write the enrichment back: an anonymous view is
    // read-only, so it gets the in-memory result without a database to persist
    // into.
    await enrichStatusAttachments(
      actualStatus,
      isStoredStatus && session ? database : undefined
    )
  }

  let ancestors: Status[] = []
  let replies: Status[] = []
  let hasMoreAncestors = false
  let hasMoreDescendants = false

  if (
    status.type === StatusType.enum.Note &&
    status.replies &&
    status.replies.length > 0
  ) {
    // If replies are embedded (e.g. temporary status), use them
    replies = status.replies as Status[]
    if (!currentActor) {
      replies = replies.filter(isStatusPubliclyReadable)
    }
  } else if (statusId) {
    if (currentActor && isStoredStatus && isBlueskyStatus(status)) {
      await loadBlueskyThread(database, currentActor, statusId)
    }
    const threadContext = await getStatusContext({
      database,
      statusId,
      status,
      currentActor,
      // The first step; "Load earlier posts" / "Load more replies" ask the
      // thread route for the next ones.
      ancestorsLimit: THREAD_INITIAL_ANCESTORS_LIMIT,
      descendantsLimit: THREAD_INITIAL_DESCENDANTS_LIMIT
    })
    ancestors = threadContext.ancestors
    replies = threadContext.descendants
    // The thread route only answers for a stored status, so a status read
    // from its origin (not stored yet) offers no "Load more" it cannot keep.
    hasMoreAncestors = isStoredStatus && threadContext.hasMoreAncestors
    hasMoreDescendants = isStoredStatus && threadContext.hasMoreDescendants
    // A signed-in view of a stored thread that stops at a missing parent
    // queues that parent's fetch (see the context route).
    if (currentActor && isStoredStatus) {
      await queueThreadGapBackfill({
        database,
        missingParentId: threadContext.missingParentId
      })
    }
  }

  const statusForLayout =
    status.type === StatusType.enum.Announce
      ? getOriginalStatus(status)
      : status
  const isFitnessDashboard =
    statusForLayout.type === StatusType.enum.Note &&
    statusForLayout.fitness?.processingStatus === 'completed'
  // The mobile Back's direct-entry fallback: the profile in this URL, which is
  // the author whose post or activity is being viewed. Built from the parsed
  // handle, never the raw segment: the resolver ignores anything before the
  // first '@', so `/%2F%2Fx%40u%40evil.example/<any public status url>` renders
  // a real post, and `/${segment}` would be the off-site `///x@u@evil.example`.
  const authorProfileHref = `/@${pathActor.username}@${pathActor.domain}`
  // …and its accessible name, "Back to profile, <name>": the display name
  // when the status is that actor's own (or their boost), else the handle.
  const isPathActorStatus =
    status.actor?.username.toLowerCase() === pathActor.username.toLowerCase() &&
    status.actor?.domain.toLowerCase() === pathActor.domain.toLowerCase()
  const authorName = profileName({
    name: isPathActorStatus ? status.actor?.name : undefined,
    username: pathActor.username,
    domain: pathActor.domain
  })

  const isStrictlyPublic = isStatusStrictlyPublic(status)
  let jsonLd: Record<string, unknown> | null = null
  if (isStrictlyPublic && actualStatus) {
    const fallbackPageUrl = `${getBaseURL()}/${encodeURIComponent(decodePathParam(actor))}/${encodeURIComponent(decodePathParam(statusParam))}`
    const { canonicalUrl: statusUrl } = getCanonicalStatusUrl(
      actualStatus,
      fallbackPageUrl
    )
    const authorUrl = getAuthorCanonicalUrl(actualStatus, authorProfileHref)
    const author = actualStatus.actor
      ? {
          '@type': 'Person',
          name: actualStatus.actor.name || actualStatus.actor.username,
          url: authorUrl
        }
      : {
          '@type': 'Person',
          name: authorName,
          url: authorUrl
        }
    const cleanSummary =
      actualStatus.type === StatusType.enum.Note && actualStatus.summary
        ? htmlToPlainText(actualStatus.summary)
        : ''
    const noteText =
      actualStatus.type === StatusType.enum.Note
        ? actualStatus.summary || actualStatus.text || ''
        : ''
    const cleanDescription =
      htmlToPlainText(noteText) || `Post by ${author.name}`
    const publishedDate = actualStatus.createdAt
      ? new Date(actualStatus.createdAt).toISOString()
      : undefined
    const fitnessSummary =
      isFitnessDashboard && actualStatus.type === StatusType.enum.Note
        ? actualStatus.fitness
        : undefined

    jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'SocialMediaPosting',
      url: statusUrl,
      name:
        cleanSummary ||
        (fitnessSummary
          ? `${author.name}'s ${fitnessSummary.activityType || 'Activity'}`
          : cleanDescription),
      headline: cleanSummary || cleanDescription.slice(0, 110),
      description: cleanDescription,
      datePublished: publishedDate,
      author,
      ...(fitnessSummary
        ? {
            about: {
              '@type': 'ExerciseAction',
              ...(fitnessSummary.activityType
                ? { exerciseType: fitnessSummary.activityType }
                : {}),
              ...(fitnessSummary.totalDistanceMeters &&
              fitnessSummary.totalDistanceMeters > 0
                ? {
                    distance: {
                      '@type': 'Distance',
                      name: `${(fitnessSummary.totalDistanceMeters / 1000).toFixed(2)} km`
                    }
                  }
                : {})
            }
          }
        : {})
    }
  }

  const safeJsonLdString = jsonLd
    ? JSON.stringify(jsonLd).replace(/</g, '\\u003c')
    : null

  if (isFitnessDashboard) {
    const [fitnessFiles, trainingZones] = await Promise.all([
      getStatusFitnessFiles(database, statusForLayout.id, currentTime),
      // Only the author's own view uses their zones: their max heart rate and
      // FTP never reach anyone else's page. Others see the default zones.
      statusForLayout.isLocalActor &&
      currentActor?.id === statusForLayout.actorId
        ? getTrainingZoneSettings(database, statusForLayout.actorId)
        : null
    ])
    // The PR badges are the owner's own records, so only the owner's page
    // reads them. A failed read only costs the badges.
    const isOwner =
      Boolean(currentActor) &&
      statusForLayout.isLocalActor !== false &&
      currentActor?.id === statusForLayout.actorId
    const personalRecordDurations = isOwner
      ? await getPersonalRecordDurations(database, {
          actorId: statusForLayout.actorId,
          fitnessFileIds: fitnessFiles.map((file) => file.id)
        }).catch((error) => {
          logger.warn({
            message: 'Failed to read the activity personal records',
            statusId: statusForLayout.id,
            err: toLoggableError(error)
          })
          return undefined
        })
      : undefined

    return (
      <>
        <MobileCompactHeader title="Activity" />
        <div
          className={cn(
            // Signed-in viewers render inside the `(timeline)` layout, whose
            // content wrapper has no top padding, so the card sits with a top
            // margin on desktop; on mobile it sits flush under the compact bar
            // rendered above it. Logged-out viewers go through `PublicShell`,
            // whose `py-6` is the gap under `PublicTopBar` at every width, so
            // they take no margin of their own.
            currentActorProfile && 'md:mt-4',
            // No `overflow-hidden`: this card wraps a post, and a post's
            // non-portalled overlays have to escape it. They all hang off the
            // action row inside the activity post — the edit-history panel
            // opening upward (`bottom-full`, ~360px) and the action-button
            // error tooltips hanging below it (`top-full`). The post is flush
            // in this card with no clip of its own, so only this card's clip
            // could still cut them off. The like button's tooltip, the
            // leftmost one, hangs past the card's left edge because the action
            // row starts close to it, so a clip here would cut it off and a
            // failed like would stay unreadable. The picker and the ⋯ popover
            // are unaffected either way; both portal to the document body.
            POST_LIST_FRAME_CLASS,
            // Below `md` a signed-in page is the full-bleed feed surface. A
            // logged-out page is not one card but a stack of inset cards (the
            // activity, then `SignInCallout`), like `PublicFooter` below them.
            currentActorProfile
              ? MOBILE_FEED_SURFACE_CLASS
              : MOBILE_INSET_STACK_CLASS
          )}
        >
          {currentActorProfile ? (
            // The clip moves onto a wrapper around the header rather than onto
            // the header itself, and it stays a clip on purpose. Rounding
            // `Header` directly would hold only while it is at rest: it is
            // `sticky top-0`, and this card's `overflow-hidden` was the
            // scrollport pinning it — without one it detaches mid-scroll and
            // carries two transparent corner notches out over the post. A
            // clipping box is safe on this subtree alone because the header
            // holds no overlays.
            <div className="overflow-hidden rounded-t-lg max-md:rounded-none">
              <Header
                isFitnessDashboard
                fallbackHref={authorProfileHref}
                fallbackName={authorName}
              />
            </div>
          ) : (
            // Logged-out view has no back-button chrome (matching the web-public
            // design), but keep a top-level heading for the document outline.
            <h1 className="sr-only">Activity</h1>
          )}

          <div
            className={cn(
              'border-b bg-background',
              // Unlike the conversation card below, this one's children paint,
              // so with the clip gone each corner they reach has to be rounded
              // here, and reset below `md` where the outer card is square and
              // full-bleed. Logged out there is no `Header` above this — the
              // `sr-only` heading is out of flow and paints nothing — so the
              // activity post, flush at the top of it, meets the top corners as
              // well (`ActivityPostFrame` rounds itself when signed out)…
              !currentActorProfile && 'rounded-t-lg',
              // …and it is the last child unless the logged-out `SignInCallout`
              // follows it, in which case that block takes the bottom corners.
              currentActorProfile && 'rounded-b-lg max-md:rounded-none',
              // Below `md` a logged-out activity is a card of its own, framed
              // all the way round (its `border-b` becomes a full border).
              !currentActorProfile && MOBILE_INSET_CARD_FRAME_CLASS
            )}
          >
            <StatusBox
              host={host}
              mapProvider={mapProvider}
              currentTime={currentTime}
              currentActor={currentActorProfile}
              status={cleanJson(status)}
              variant="detail"
              isMediaUploadEnabled={Boolean(mediaStorage)}
              replies={replies.map((reply) => cleanJson(reply))}
              ancestors={ancestors.map((item) => cleanJson(item))}
              hasMoreAncestors={hasMoreAncestors}
              hasMoreDescendants={hasMoreDescendants}
              fitnessFiles={fitnessFiles}
              personalRecordDurations={personalRecordDurations}
              trainingZones={trainingZones}
            />
          </div>

          {!currentActorProfile ? (
            // Paints `bg-primary/5` and is the last child whenever it renders,
            // so it is what meets the bottom corners on the logged-out view.
            <SignInCallout
              registrationOpen={registrationOpen}
              className={cn('rounded-b-lg', MOBILE_INSET_CARD_FRAME_CLASS)}
            />
          ) : null}
        </div>
        {safeJsonLdString ? (
          <script
            type="application/ld+json"
            nonce={nonce}
            dangerouslySetInnerHTML={{ __html: safeJsonLdString }}
          />
        ) : null}
      </>
    )
  }

  return (
    <>
      <MobileCompactHeader title="Post" />
      <div
        className={cn(
          // Signed-in viewers render inside the `(timeline)` layout, whose
          // content wrapper has no top padding on desktop; on mobile the card
          // sits flush under the compact bar rendered above it. Logged-out
          // viewers go through `PublicShell`, whose `py-6` is the gap under
          // `PublicTopBar` at every width, so they take no margin of their own.
          currentActorProfile && 'md:mt-4',
          // No `overflow-hidden`: this card contains posts, and a post's
          // non-portalled overlays would be clipped by it — the same reason
          // `Posts` dropped it. The one that reaches this card's edge is the
          // edit-history panel: it opens *upward* from the action row
          // (`bottom-full`, ~360px — a 2.5rem header over a `max-h-80` list),
          // and the only viewer who gets an action row at all is a signed-in
          // one, whose focused post sits directly below the back-button bar
          // whenever the post is not a reply. So on a short post with a few
          // edits the panel runs past the top edge. A reply pushes it down by up
          // to three ancestor rows, which buys room but does not settle it — a
          // post edited enough times to fill the list still overruns a short
          // chain. The panel's *horizontal* fit is its own problem and already
          // solved — it anchors to the action row so it tracks the post's width
          // — so this class governs the vertical overrun only.
          // The reaction picker and the ⋯ menu's *popover* are not why — both
          // portal to the document body, so no ancestor's overflow reaches them
          // (`PostMenu`'s own error tooltip is not portalled, but it hangs
          // `top-full` mid-card, nowhere near an edge).
          //
          // The children that meet the corners round themselves. The last
          // child is the replies wrapper or the "No replies yet" block, neither
          // of which paints a background, or, at the end of a conversation with
          // no replies, the focused post, which rounds its own bottom corners —
          // append another background-painting child last and it will need the
          // same treatment.
          POST_LIST_FRAME_CLASS,
          // Below `md` a signed-in page is the full-bleed feed surface. A
          // logged-out page is not one card but a stack of inset cards (the
          // thread, then `SignInCallout`), like `PublicFooter` below them; the
          // thread card is `StatusThread`'s own `className`.
          currentActorProfile
            ? MOBILE_FEED_SURFACE_CLASS
            : MOBILE_INSET_STACK_CLASS
        )}
      >
        {currentActorProfile ? (
          // Rounds the header by clipping a wrapper rather than by putting the
          // radius on the header itself, because `Header` is `sticky top-0` and
          // the radius has to survive it.
          //
          // That `sticky` has never actually engaged: an ancestor with
          // `overflow: hidden` is the scrollport for a sticky descendant, and
          // both of this file's `Header` call sites had one (the fitness card
          // still does). Dropping this card's clip would have made the viewport
          // the scrollport and started the bar detaching mid-scroll for the
          // first time — carrying two transparent corner notches out over the
          // posts, since `background` and `backdrop-filter` both clip to the
          // radius. A wrapper exactly the header's height keeps the sticky inert
          // as it has always been, and clipping is free here because, unlike the
          // rest of the card, this subtree holds no overlays.
          //
          // So the header still does not stick, on either call site. Whether it
          // should is a live question, but it is not this change's to answer.
          <div className="overflow-hidden rounded-t-lg max-md:rounded-none">
            <Header
              isFitnessDashboard={false}
              fallbackHref={authorProfileHref}
              fallbackName={authorName}
            />
          </div>
        ) : (
          // Logged-out view has no back-button chrome (matching the web-public
          // design), but keep a top-level heading for the document outline.
          <h1 className="sr-only">Post</h1>
        )}

        <PagedStatusThread
          key={status.id}
          host={host}
          status={cleanJson(status)}
          ancestors={ancestors.map((item) => cleanJson(item))}
          descendants={replies.map((reply) => cleanJson(reply))}
          currentActor={currentActorProfile}
          currentTime={currentTime}
          className={currentActorProfile ? undefined : MOBILE_INSET_CARD_CLASS}
          isMediaUploadEnabled={Boolean(mediaStorage)}
          hasMoreAncestors={hasMoreAncestors}
          hasMoreDescendants={hasMoreDescendants}
          focusedFooter={
            currentActorProfile ? (
              <StatusLikes
                statusId={actualStatus.id}
                totalLikes={actualStatus.totalLikes}
              />
            ) : null
          }
        />

        {!currentActorProfile ? (
          <SignInCallout
            registrationOpen={registrationOpen}
            className={MOBILE_INSET_CARD_FRAME_CLASS}
          />
        ) : null}
      </div>
      {safeJsonLdString ? (
        <script
          type="application/ld+json"
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: safeJsonLdString }}
        />
      ) : null}
    </>
  )
}

export default Page
