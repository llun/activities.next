import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { notFound } from 'next/navigation'
import { FC } from 'react'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getActorProfile } from '@/lib/types/domain/actor'
import { FollowStatus } from '@/lib/types/domain/follow'
import { Status, StatusType } from '@/lib/types/domain/status'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'
import { cleanJson } from '@/lib/utils/cleanJson'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { logger } from '@/lib/utils/logger'

import { Header } from './Header'
import { StatusBox } from './StatusBox'

interface Props {
  params: Promise<{ actor: string; status: string }>
}

export const generateMetadata = async ({
  params
}: Props): Promise<Metadata> => {
  const { actor } = await params
  return {
    title: `Activities.next: ${decodeURIComponent(actor)} status`
  }
}

const Page: FC<Props> = async ({ params }) => {
  const { host } = getConfig()
  const database = getDatabase()
  if (!database) throw new Error('Database is not available')

  const session = await getServerSession(getAuthOptions())
  const currentActor = await getActorFromSession(database, session)
  const currentActorProfile = currentActor
    ? getActorProfile(currentActor)
    : null

  const { actor, status: statusParam } = await params
  const currentTime = new Date()
  const decodedActor = decodeURIComponent(actor)
  const decodedStatusParam = (() => {
    try {
      return decodeURIComponent(statusParam)
    } catch {
      return statusParam
    }
  })()

  const parts = decodedActor.split('@').slice(1)
  if (parts.length !== 2) {
    return notFound()
  }

  const protocol = parts[1].startsWith('localhost') ? 'http' : 'https'
  const isFullStatusUrl = /^https?:\/\//.test(decodedStatusParam)
  const fullStatusId = isFullStatusUrl
    ? decodedStatusParam
    : `${protocol}://${parts[1]}/users/${parts[0]}/statuses/${decodedStatusParam}`

  // Try full URL format first (ActivityPub standard), then fallback to raw id (for legacy/mock data)
  let status = await database.getStatus({
    statusId: fullStatusId,
    withReplies: false
  })
  let statusId = fullStatusId

  if (!status && !isFullStatusUrl) {
    status = await database.getStatus({
      statusId: decodedStatusParam,
      withReplies: false
    })
    statusId = decodedStatusParam
  }

  if (!status) {
    return notFound()
  }

  const statusUrl =
    status.type === StatusType.enum.Announce
      ? status.originalStatus.url
      : status.url

  const replies = await database.getStatusReplies({
    statusId,
    url: statusUrl
  })

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

  // Type for placeholder when parent status doesn't exist in local database
  type PlaceholderStatus = { id: string; isMissing: true }

  const previouses: Array<Status | PlaceholderStatus> = []
  if (status.type !== StatusType.enum.Announce && status.reply) {
    let replyId = status.reply
    let replyStatus = await database.getStatus({
      statusId: replyId,
      withReplies: false
    })

    while (previouses.length < 3) {
      if (replyStatus) {
        previouses.push(replyStatus)
        // Announce statuses cannot be replies according to ActivityPub spec
        if (replyStatus.type === StatusType.enum.Announce) {
          break
        }
        if (!replyStatus.reply) {
          break
        }
        replyId = replyStatus.reply
        replyStatus = await database.getStatus({
          statusId: replyStatus.reply,
          withReplies: false
        })
      } else {
        // Parent doesn't exist locally - queue job to fetch it in background
        // This is fire-and-forget - we show placeholder immediately
        // Call API endpoint to queue the fetch job
        fetch(`https://${host}/api/v1/statuses/fetch-remote`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ statusUrl: replyId })
        }).catch((error) => {
          // Log error but don't block rendering
          logger.error(
            { error, statusUrl: replyId },
            'Failed to queue fetch job'
          )
        })

        // Add placeholder to show that fetch is in progress
        previouses.push({ id: replyId, isMissing: true })
        break
      }
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-background/80 shadow-sm">
      <Header />

      {previouses.reverse().map((item) => {
        // Check if this is a placeholder for unavailable status
        if ('isMissing' in item) {
          // It's a placeholder for missing parent status
          return (
            <div
              key={item.id}
              className="border-b border-l-4 border-l-primary/20 bg-muted/30"
            >
              <div className="p-4 text-sm text-muted-foreground">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0">
                    <div className="h-10 w-10 rounded-full bg-muted" />
                  </div>
                  <div className="flex-1">
                    <div className="mb-2 font-medium">
                      Fetching parent status...
                    </div>
                    <div className="text-xs">
                      The parent status is being fetched from the remote server
                      in the background.{' '}
                      <span className="font-semibold">
                        Please refresh this page in a moment to view it.
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )
        } else {
          // It's a real Status object
          return (
            <div
              key={item.id}
              className="border-b border-l-4 border-l-primary/20 bg-muted/30"
            >
              <StatusBox
                host={host}
                currentTime={currentTime}
                currentActor={currentActorProfile}
                status={cleanJson(item)}
              />
            </div>
          )
        }
      })}

      <div className="border-b bg-background">
        <StatusBox
          host={host}
          currentTime={currentTime}
          currentActor={currentActorProfile}
          status={cleanJson(status)}
          variant="detail"
        />
      </div>

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
