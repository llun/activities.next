import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { FC } from 'react'

import { getRemoteStatus } from '@/lib/activities/getRemoteStatus'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { FETCH_REMOTE_STATUS_JOB_NAME } from '@/lib/jobs/names'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getQueue } from '@/lib/services/queue'
import {
  canActorReadStatus,
  isStatusPubliclyReadable
} from '@/lib/services/statusAccess'
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
import { getPublicMapboxAccessToken } from '@/lib/utils/mapbox'

import { Header } from './Header'
import { RemoteStatusLoading } from './RemoteStatusLoading'
import { SignInCallout } from './SignInCallout'
import { StatusBox } from './StatusBox'
import { StatusStatStrip } from './StatusStatStrip'
import { decodePathParam, resolveStatusFromPath } from './resolveStatusFromPath'

interface Props {
  params: Promise<{ actor: string; status: string }>
}

export const generateMetadata = async ({
  params
}: Props): Promise<Metadata> => {
  const { actor } = await params
  return {
    title: `Activities.next: ${decodePathParam(actor)} status`
  }
}

const Page: FC<Props> = async ({ params }) => {
  const { host, fitnessStorage, mediaStorage, registrationOpen } = getConfig()
  const mapboxAccessToken = getPublicMapboxAccessToken(
    fitnessStorage?.mapboxAccessToken
  )
  const database = getDatabase()
  if (!database) throw new Error('Database is not available')

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
    statusParam
  })
  if (!resolvedStatus) return notFound()

  const { fullStatusId, isStatusHash } = resolvedStatus
  let { status, statusId } = resolvedStatus

  if (!status && !isStatusHash && fullStatusId) {
    status = await getRemoteStatus({
      statusId: fullStatusId,
      signingActor: currentActor ?? undefined
    })
    statusId = status?.id ?? ''

    // A live-fetched remote status carries no replies (`fromNote` sets
    // `replies: []`) and its thread is not in our database yet, so a signed-in
    // viewer would see an empty reply list. Queue the fetch job to persist the
    // status plus its full reply thread. Under the in-process NoQueue this runs
    // inline, so the replies are already stored by the time the query below
    // runs; under a real queue they appear on a subsequent view. Because the job
    // persists the focused status, later views resolve it from the database and
    // skip this branch entirely — bounding repeat fetches for popular posts.
    if (status && status.type === StatusType.enum.Note && session) {
      // A queue failure (service down, rate limited) must not 500 the page —
      // the live-fetched status is still renderable, so log and continue. Under
      // NoQueue this runs the job inline; the same guard keeps a thrown reply
      // walk from taking down the render.
      try {
        const queue = getQueue()
        await queue.publish({
          id: `fetch-remote-status-${fullStatusId}`,
          name: FETCH_REMOTE_STATUS_JOB_NAME,
          data: { statusId: fullStatusId }
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
    // Queue the fetch job with a deterministic ID to avoid duplicates
    await queue.publish({
      id: `fetch-remote-status-${fullStatusId}`,
      name: FETCH_REMOTE_STATUS_JOB_NAME,
      data: { statusId: fullStatusId }
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

  const statusUrl =
    status.type === StatusType.enum.Announce
      ? getOriginalStatus(status).url
      : status.url

  let replies: Status[]

  if (
    status.type === StatusType.enum.Note &&
    status.replies &&
    status.replies.length > 0
  ) {
    // If replies are embedded (e.g. temporary status), use them
    replies = status.replies as Status[]
  } else {
    // Otherwise fetch from database. The query filters to statuses the current
    // viewer may read: logged-out visitors only ever see public/unlisted
    // replies, while logged-in viewers get replies scoped to their own
    // visibility (own posts, direct messages addressed to them, and
    // followers-only posts from authors they have an accepted follow with).
    replies = await database.getStatusReplies({
      statusId,
      url: statusUrl,
      ...(currentActor
        ? { visibleToActorId: currentActor.id }
        : { publicOnly: true })
    })
  }

  // Object-level visibility backstop for logged-out visitors. Covers the
  // embedded-replies path above (which never hits the query filter) and any
  // stale/malformed recipient rows the query might miss, so a private reply to
  // a public status never reaches an anonymous viewer (and isn't counted in the
  // reply heading). Logged-in viewers rely on the query's `visibleToActorId`
  // filter instead: it is the authoritative visibility check (it also matches
  // recipientless replies to the viewer's own posts), so re-filtering with the
  // simpler `isStatusPubliclyReadable` here would wrongly hide replies they may
  // read.
  if (!currentActor) {
    replies = replies.filter(isStatusPubliclyReadable)
  }

  const previouses = []
  if (status.type !== StatusType.enum.Announce && status.reply) {
    let replyStatus = await database.getStatus({
      statusId: status.reply,
      withReplies: false
    })
    while (previouses.length < 3 && replyStatus) {
      // `getStatus` does no visibility filtering, so without this guard a public
      // reply to a followers-only (or direct) parent would leak that private
      // ancestor to a viewer who cannot read it. Stop the chain at the first
      // ancestor the viewer may not read. `canActorReadStatus` collapses to the
      // public/unlisted check when `currentActor` is null, covering both
      // logged-out and logged-in viewers.
      const canReadAncestor = await canActorReadStatus({
        database,
        status: replyStatus,
        currentActor
      })
      if (!canReadAncestor) {
        break
      }
      previouses.push(replyStatus)
      // This should be impossible
      if (replyStatus.type === StatusType.enum.Announce) {
        break
      }
      if (!replyStatus.reply) {
        break
      }
      replyStatus = await database.getStatus({
        statusId: replyStatus.reply,
        withReplies: false
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

  if (isFitnessDashboard) {
    return (
      <div
        className={cn(
          // Signed-in viewers render inside the `(timeline)` layout, whose
          // content wrapper has no top padding, so the card would otherwise sit
          // flush against the top. Logged-out viewers go through `PublicShell`,
          // which already supplies its own top padding, so only the signed-in
          // surface needs this gap.
          currentActorProfile && 'mt-4',
          'overflow-hidden rounded-2xl border bg-background/80 shadow-sm'
        )}
      >
        {currentActorProfile ? (
          <Header isFitnessDashboard />
        ) : (
          // Logged-out view has no back-button chrome (matching the web-public
          // design), but keep a top-level heading for the document outline.
          <h1 className="sr-only">Activity</h1>
        )}

        <div className="border-b bg-background">
          <StatusBox
            host={host}
            mapboxAccessToken={mapboxAccessToken}
            currentTime={currentTime}
            currentActor={currentActorProfile}
            status={cleanJson(status)}
            variant="detail"
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
          <SignInCallout registrationOpen={registrationOpen} />
        ) : null}
      </div>
    )
  }

  return (
    <div
      className={cn(
        // Only the signed-in `(timeline)` surface lacks top padding; the
        // logged-out `PublicShell` already provides its own, so scope the gap
        // to the signed-in card to keep the spacing consistent across both.
        currentActorProfile && 'mt-4',
        'overflow-hidden rounded-2xl border bg-background/80 shadow-sm'
      )}
    >
      {currentActorProfile ? (
        <Header isFitnessDashboard={false} />
      ) : (
        // Logged-out view has no back-button chrome (matching the web-public
        // design), but keep a top-level heading for the document outline.
        <h1 className="sr-only">Post</h1>
      )}

      {previouses.reverse().map((item) => (
        <div
          key={item.id}
          className="border-b border-l-4 border-l-primary/20 bg-muted/30"
        >
          <StatusBox
            host={host}
            mapboxAccessToken={mapboxAccessToken}
            currentTime={currentTime}
            currentActor={currentActorProfile}
            status={cleanJson(item)}
          />
        </div>
      ))}

      <div className="border-b bg-background">
        <StatusBox
          host={host}
          mapboxAccessToken={mapboxAccessToken}
          currentTime={currentTime}
          currentActor={currentActorProfile}
          status={cleanJson(status)}
          variant="detail"
          isMediaUploadEnabled={Boolean(mediaStorage)}
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
        <SignInCallout registrationOpen={registrationOpen} />
      ) : null}

      {replies.length > 0 ? (
        <div>
          <div className="border-b px-5 py-3">
            <h2 className="font-semibold">Replies ({replies.length})</h2>
          </div>

          <div className="divide-y">
            {replies.map((reply) => (
              <StatusBox
                key={reply.id}
                host={host}
                mapboxAccessToken={mapboxAccessToken}
                currentTime={currentTime}
                currentActor={currentActorProfile}
                status={cleanJson(reply)}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="p-8 text-center text-muted-foreground">
          No replies yet
        </div>
      )}
    </div>
  )
}

export default Page
