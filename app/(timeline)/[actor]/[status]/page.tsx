import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { notFound } from 'next/navigation'
import { FC } from 'react'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getActorProfile } from '@/lib/models/actor'
import { FollowStatus } from '@/lib/models/follow'
import { StatusType } from '@/lib/models/status'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'
import { cleanJson } from '@/lib/utils/cleanJson'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

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

  const previouses = []
  if (status.type !== StatusType.enum.Announce && status.reply) {
    let replyStatus = await database.getStatus({
      statusId: status.reply,
      withReplies: false
    })
    while (previouses.length < 3 && replyStatus) {
      previouses.push(replyStatus)
      // This should be impossible
      if (replyStatus.type === StatusType.enum.Announce) {
        replyStatus = null
        break
      }
      if (!replyStatus.reply) {
        replyStatus = null
        break
      }
      replyStatus = await database.getStatus({
        statusId: replyStatus.reply,
        withReplies: false
      })
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-background/80 shadow-sm">
      <Header />

      {previouses.reverse().map((item) => (
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
      ))}

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
