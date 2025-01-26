import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { FC } from 'react'

import { Posts } from '@/lib/components/Posts/Posts'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMACT
} from '@/lib/utils/jsonld/activitystream'

import { StatusBox } from './StatusBox'
import styles from './[status].module.scss'

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

  const { actor, status: id } = await params
  const currentTime = new Date()
  const parts = decodeURIComponent(actor).split('@').slice(1)
  if (parts.length !== 2) {
    return notFound()
  }

  const statusId = `https://${parts[1]}/users/${parts[0]}/statuses/${id}`
  const [status, replies] = await Promise.all([
    database.getStatus({ statusId, withReplies: false }),
    database.getStatusReplies({ statusId })
  ])
  if (!status) {
    return notFound()
  }

  if (
    !(
      status.to.includes(ACTIVITY_STREAM_PUBLIC) ||
      status.to.includes(ACTIVITY_STREAM_PUBLIC_COMACT)
    )
  ) {
    return notFound()
  }

  const previouses = []
  if (status.reply) {
    let replyStatus = await database.getStatus({
      statusId: status.reply,
      withReplies: false
    })
    while (previouses.length < 3 && replyStatus) {
      previouses.push(replyStatus.toJson())
      if (!replyStatus.reply) {
        replyStatus = undefined
        break
      }
      replyStatus = await database.getStatus({
        statusId: replyStatus.reply,
        withReplies: false
      })
    }
  }

  return (
    <>
      <Posts
        className="mt-4"
        currentTime={currentTime}
        host={host}
        statuses={previouses}
      />
      <section className={styles.highlight}>
        <StatusBox
          host={host}
          currentTime={currentTime}
          status={status.toJson()}
        />
      </section>
      <Posts
        className="mt-4"
        currentTime={currentTime}
        host={host}
        statuses={replies.map((reply) => reply.toJson())}
      />
    </>
  )
}

export default Page
