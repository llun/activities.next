import { notFound } from 'next/navigation'
import { FC } from 'react'

import { Posts } from '@/lib/components/Posts/Posts'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMACT
} from '@/lib/jsonld/activitystream'
import { getStorage } from '@/lib/storage'

import { StatusBox } from './StatusBox'
import styles from './[status].module.scss'

interface Props {
  params: { actor: string; status: string }
}

const Page: FC<Props> = async ({ params }) => {
  const storage = await getStorage()
  if (!storage) throw new Error('Storage is not available')

  const { actor, status: id } = params
  const currentTime = new Date()
  const parts = decodeURIComponent(actor).split('@').slice(1)
  if (parts.length !== 2) {
    return notFound()
  }

  const statusId = `https://${parts[1]}/users/${parts[0]}/statuses/${id}`
  const [status, replies] = await Promise.all([
    storage.getStatus({ statusId, withReplies: false }),
    storage.getStatusReplies({ statusId })
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
    let replyStatus = await storage.getStatus({
      statusId: status.reply,
      withReplies: false
    })
    while (previouses.length < 3 && replyStatus) {
      previouses.push(replyStatus.toJson())
      if (!replyStatus.reply) {
        replyStatus = undefined
        break
      }
      replyStatus = await storage.getStatus({
        statusId: replyStatus.reply,
        withReplies: false
      })
    }
  }

  return (
    <>
      <Posts className="mt-4" currentTime={currentTime} statuses={previouses} />
      <section className={styles.highlight}>
        <StatusBox currentTime={currentTime} status={status.toJson()} />
      </section>
      <Posts
        className="mt-4"
        currentTime={currentTime}
        statuses={replies.map((reply) => reply.toJson())}
      />
    </>
  )
}

export default Page
