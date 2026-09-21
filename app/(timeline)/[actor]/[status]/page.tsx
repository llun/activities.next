import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { FC } from 'react'

import { getRemoteStatus } from '@/lib/activities/getRemoteStatus'
import { MOBILE_FEED_SURFACE_CLASS } from '@/lib/components/posts/feedLayout'
import { StatusThread } from '@/lib/components/posts/status-thread'
import { getBaseURL, getConfig } from '@/lib/config'
import { getPublicMapProvider } from '@/lib/config/mapProvider'
import { getDatabase } from '@/lib/database'
import { FETCH_REMOTE_STATUS_JOB_NAME } from '@/lib/jobs/names'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { enrichStatusAttachments } from '@/lib/services/medias/animationMetadata'
import { getQueue } from '@/lib/services/queue'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import {
  canActorReadStatus,
  isStatusPubliclyReadable
} from '@/lib/services/statusAccess'
import { getStatusContext } from '@/lib/services/statuses/getStatusContext'
import { getActorProfile } from '@/lib/types/domain/actor'
import {
  Status,
  StatusType,
  getOriginalStatus
} from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'
import { cleanJson } from '@/lib/utils/cleanJson'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { logger } from '@/lib/utils/logger'

import { Header } from './Header'
import { RemoteStatusLoading } from './RemoteStatusLoading'
import { SignInCallout } from './SignInCallout'
import { StatusBox } from './StatusBox'
import { StatusLikes } from './StatusLikes'
import { StatusStatStrip } from './StatusStatStrip'
import { decodePathParam, resolveStatusFromPath } from './resolveStatusFromPath'

interface Props {
  params: Promise<{ actor: string; status: string }>
}

export const generateMetadata = async ({
  params
}: Props): Promise<Metadata> => {
  const { actor, status } = await params
  const decodedActor = decodePathParam(actor)
  // Deterministically re-encoded page URL: the status segment can itself be a
  // full remote status URL, so each segment is percent-encoded to survive the
  // round-trip through the oEmbed endpoint's URL parser.
  const pageUrl = `${getBaseURL()}/${encodeURIComponent(decodedActor)}/${encodeURIComponent(decodePathParam(status))}`
  return {
    title: `Activities.next: ${decodedActor} status`,
    alternates: {
      types: {
        // oEmbed discovery link (https://oembed.com/#section4): consumers read
        // <link rel="alternate" type="application/json+oembed"> from the
        // public status page to find GET /api/oembed.
        'application/json+oembed': `${getBaseURL()}/api/oembed?url=${encodeURIComponent(pageUrl)}`
      }
    }
  }
}

const Page: FC<Props> = async ({ params }) => {
  const { host, mediaStorage } = getConfig()
  const mapProvider = getPublicMapProvider()
  const database = getDatabase()
  if (!database) throw new Error('Database is not available')
  const {
    registrations: { open: registrationOpen }
  } = await getResolvedServerSettings(database)

  const session = await getServerAuthSession()
  const currentActor = await getActorFromSession(database, session)
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

  const { fullStatusId, isStatusHash } = resolvedStatus
  let { status, statusId } = resolvedStatus

  if (!status && !isStatusHash && fullStatusId) {
    // Server-to-server federation fetches must be signed by the dedicated
    // headless instance actor, never the viewer's user actor. Instances running
    // in authorized-fetch ("secure") mode reject unsigned/unverifiable requests,
    // and the viewer may not have a usable signing actor at all (e.g. a
    // logged-in account without a local actor, or one whose key is not publicly
    // resolvable on a multi-domain setup). The instance actor always exists, has
    // a private key, and is served at a publicly resolvable URL so the remote
    // can verify the signature; without it, posts on secure-mode instances 404.
    // Resolution is best-effort: a missing/failed instance actor must degrade to
    // an unsigned fetch rather than turning a clean 404 into a 500. The failure
    // is surfaced (not swallowed) so a persistently broken signer stays
    // diagnosable. getRemoteStatus is shared with search, which intentionally
    // signs as the requesting user, so only this call site is changed.
    const signingActor = await getFederationSigningActor(database).catch(
      (error) => {
        logger.warn({
          message:
            'Failed to resolve federation signing actor for remote status fetch; falling back to an unsigned request',
          error: error instanceof Error ? error.message : String(error)
        })
        return undefined
      }
    )
    status = await getRemoteStatus({
      statusId: fullStatusId,
      signingActor
    })
    statusId = status?.id ?? ''

    // A live-fetched remote status carries no replies (`fromNote` sets
    // `replies: []`) and its thread is not in our database yet, so a signed-in
    // viewer would see an empty reply list. Queue the fetch job to persist the
    // status plus its reply thread. Because the job persists the focused status,
    // later views resolve it from the database and skip this branch entirely —
    // bounding repeat fetches for popular posts.
    if (status && status.type === StatusType.enum.Note && session) {
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

  // Try to fetch remote status if not found and user is logged in
  if (!status && session && !isStatusHash) {
    const queue = getQueue()
    // Queue the fetch job with a deterministic ID to avoid duplicates. As above,
    // an inline NoQueue run is kept to the focused note's direct replies so the
    // awaited call stays fast; a real queue walks the full thread out of band.
    await queue.publish({
      id: `fetch-remote-status-${fullStatusId}`,
      name: FETCH_REMOTE_STATUS_JOB_NAME,
      data: { statusId: fullStatusId, firstPageOnly: queue.runsInline }
    })

    // Show loading state
    return <RemoteStatusLoading />
  }

  if (!status) {
    return notFound()
  }

  // Focused-status visibility gate — the single source of truth shared with the
  // ancestor chain below. `canActorReadStatus` collapses to the public/unlisted
  // check for logged-out visitors and, for an Announce, recurses into the
  // boosted status, so a public boost of a followers-only post is rejected
  // unless the viewer follows the boosted author. It also exact-matches the
  // author's stored `followersUrl` (rather than a loose `/followers` suffix), so
  // a remote follower of a followers-only post is no longer misread as a
  // direct-message non-recipient. Gating here, before the reply fetch, rejects
  // unreadable statuses for every viewer up front.
  if (!(await canActorReadStatus({ database, status, currentActor }))) {
    return notFound()
  }

  const actualStatus = getOriginalStatus(status)
  if (actualStatus && actualStatus.type === StatusType.enum.Note) {
    await enrichStatusAttachments(actualStatus, database)
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
    const threadContext = await getStatusContext({
      database,
      statusId,
      status,
      currentActor,
      ancestorsLimit: 40,
      descendantsLimit: 60
    })
    ancestors = threadContext.ancestors
    replies = threadContext.descendants
    hasMoreAncestors = threadContext.hasMoreAncestors
    hasMoreDescendants = threadContext.hasMoreDescendants
  }

  const statusForLayout =
    status.type === StatusType.enum.Announce
      ? getOriginalStatus(status)
      : status
  const isFitnessDashboard =
    statusForLayout.type === StatusType.enum.Note &&
    statusForLayout.fitness?.processingStatus === 'completed'

  if (isFitnessDashboard) {
    return (
      <div
        className={cn(
          // Signed-in viewers render inside the `(timeline)` layout, whose
          // content wrapper has no top padding, so the card sits with a top
          // margin on desktop. On mobile, the header hosts the navigation
          // trigger and sits flush at the top of the viewport. Logged-out
          // viewers go through `PublicShell`, which supplies its own top
          // padding (`py-6`); on desktop that gap is kept, while on mobile
          // `max-md:-mt-6` pulls the card flush beneath `PublicTopBar`.
          currentActorProfile ? 'md:mt-4' : 'max-md:-mt-6',
          // No `overflow-hidden`: this card wraps a post, and a post's
          // non-portalled overlays have to escape it. They all hang off the
          // action row inside `FitnessStatusDetail`'s own card — the
          // edit-history panel opening upward (`bottom-full`, ~360px) and the
          // action-button error tooltips hanging below it (`top-full`) — and
          // that card dropping its clip only got them out of the *inner* box.
          // The like button's tooltip — the leftmost one that renders — still
          // starts ~14px left of this card's edge, which this clip then cut
          // off, so a failed bookmark stayed unreadable. The picker and the ⋯
          // popover are unaffected either way; both portal to the document
          // body.
          'rounded-2xl border bg-background/80 shadow-sm',
          MOBILE_FEED_SURFACE_CLASS
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
          <div className="overflow-hidden rounded-t-2xl max-md:rounded-none">
            <Header isFitnessDashboard />
          </div>
        ) : (
          // Logged-out view has no back-button chrome (matching the web-public
          // design), but keep a top-level heading for the document outline.
          <h1 className="sr-only">Activity</h1>
        )}

        <div
          className={cn(
            'border-b bg-background max-md:rounded-none',
            // Unlike the conversation card below, this one's children paint,
            // so with the clip gone each corner they reach has to be rounded
            // here, and reset below `md` where the outer card is square and
            // full-bleed. Logged out there is no `Header` above this — the
            // `sr-only` heading is out of flow and paints nothing — so it meets
            // the top corners as well…
            !currentActorProfile && 'rounded-t-2xl',
            // …and it is the last child unless the logged-out `SignInCallout`
            // follows it, in which case that block takes the bottom corners.
            currentActorProfile && 'rounded-b-2xl'
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
          />
          {!currentActorProfile ? (
            <div className="px-4 pb-4">
              <StatusStatStrip
                boosts={statusForLayout.totalShares}
                likes={statusForLayout.totalLikes}
                replies={replies.length}
              />
            </div>
          ) : null}
        </div>

        {!currentActorProfile ? (
          // Paints `bg-primary/5` and is the last child whenever it renders,
          // so it is what meets the bottom corners on the logged-out view.
          <SignInCallout
            registrationOpen={registrationOpen}
            className="rounded-b-2xl max-md:rounded-none"
          />
        ) : null}
      </div>
    )
  }

  return (
    <div
      className={cn(
        // Signed-in viewers render inside the `(timeline)` layout, whose
        // content wrapper has no top padding on desktop; on mobile the header
        // hosts the navigation trigger and sits flush at the top of the
        // viewport. Logged-out viewers go through `PublicShell`, which supplies
        // its own top padding (`py-6`); on desktop that gap is kept, while on
        // mobile `max-md:-mt-6` pulls the card flush beneath `PublicTopBar`.
        currentActorProfile ? 'md:mt-4' : 'max-md:-mt-6',
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
        // Only the top corners need compensating: the children that meet them
        // round themselves. The last child is always the replies wrapper or
        // the "No replies yet" block, neither of which paints a background —
        // append a background-painting child last and the bottom corners will
        // need the same treatment.
        'rounded-2xl border bg-background/80 shadow-sm',
        MOBILE_FEED_SURFACE_CLASS
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
        <div className="overflow-hidden rounded-t-2xl max-md:rounded-none">
          <Header isFitnessDashboard={false} />
        </div>
      ) : (
        // Logged-out view has no back-button chrome (matching the web-public
        // design), but keep a top-level heading for the document outline.
        <h1 className="sr-only">Post</h1>
      )}

      <StatusThread
        host={host}
        status={cleanJson(status)}
        ancestors={ancestors.map((item) => cleanJson(item))}
        descendants={replies.map((reply) => cleanJson(reply))}
        currentActor={currentActorProfile}
        currentTime={currentTime}
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
        <SignInCallout registrationOpen={registrationOpen} />
      ) : null}
    </div>
  )
}

export default Page
