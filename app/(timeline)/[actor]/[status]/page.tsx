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
import { FollowStatus } from '@/lib/types/domain/follow'
import {
  Status,
  StatusType,
  getOriginalStatus
} from '@/lib/types/domain/status'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'
import { cleanJson } from '@/lib/utils/cleanJson'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
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
  const { host, fitnessStorage, mediaStorage } = getConfig()
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

  // Logged-out visitors may only view statuses that are publicly readable all
  // the way down. The per-field `isPublicOrUnlisted` check below inspects only
  // the top-level recipients — for an Announce those are the boost's, not the
  // boosted note's — so a public boost of a followers-only post would otherwise
  // slip through. `isStatusPubliclyReadable` recurses into the original status.
  if (!currentActor && !isStatusPubliclyReadable(status)) {
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

  // Check if the status is publicly visible (public or unlisted)
  const isPublicOrUnlisted =
    status.to.includes(ACTIVITY_STREAM_PUBLIC) ||
    status.to.includes(ACTIVITY_STREAM_PUBLIC_COMPACT) ||
    status.cc.includes(ACTIVITY_STREAM_PUBLIC) ||
    status.cc.includes(ACTIVITY_STREAM_PUBLIC_COMPACT)

  // If not public/unlisted, check visibility based on privacy level
  if (!isPublicOrUnlisted) {
    // Private posts require authentication
    if (!currentActor) {
      return notFound()
    }

    // Authors can always see their own non-public statuses
    if (currentActor.id !== status.actorId) {
      // Check if this is a followers-only post (private) or direct message
      const hasFollowersUrl = [...status.to, ...status.cc].some((item) =>
        item.endsWith('/followers')
      )

      if (hasFollowersUrl) {
        // Private (followers-only) post: Check if user follows the author
        const follow = await database.getAcceptedOrRequestedFollow({
          actorId: currentActor.id,
          targetActorId: status.actorId
        })

        // Only accepted follows grant access to private posts
        if (!follow || follow.status !== FollowStatus.enum.Accepted) {
          return notFound()
        }
      } else {
        // Direct message: Only allow if current user is explicitly mentioned in to/cc
        const isRecipient =
          status.to.includes(currentActor.id) ||
          status.cc.includes(currentActor.id)

        if (!isRecipient) {
          return notFound()
        }
      }
    }
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
      <div className="overflow-hidden rounded-2xl border bg-background/80 shadow-sm">
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

        {!currentActorProfile ? <SignInCallout /> : null}
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-background/80 shadow-sm">
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

      {!currentActorProfile ? <SignInCallout /> : null}

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
