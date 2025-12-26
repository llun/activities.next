import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { FC } from 'react'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { StatusType } from '@/lib/models/status'
import { cleanJson } from '@/lib/utils/cleanJson'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMACT
} from '@/lib/utils/jsonld/activitystream'

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

  const replies = await database.getStatusReplies({ statusId })

  if (
    !(
      status.to.includes(ACTIVITY_STREAM_PUBLIC) ||
      status.to.includes(ACTIVITY_STREAM_PUBLIC_COMACT)
    )
  ) {
    return notFound()
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
            status={cleanJson(item)}
          />
        </div>
      ))}

      <div className="border-b bg-background">
        <StatusBox
          host={host}
          currentTime={currentTime}
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
