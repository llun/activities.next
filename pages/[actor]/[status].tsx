/* eslint-disable camelcase */
import cn from 'classnames'
import { GetServerSideProps, NextPage } from 'next'
import { useSession } from 'next-auth/react'
import Head from 'next/head'
import { useState } from 'react'

import { Header } from '../../lib/components/Header'
import { Modal } from '../../lib/components/Modal'
import { Media } from '../../lib/components/Posts/Media'
import { Post } from '../../lib/components/Posts/Post'
import { Posts } from '../../lib/components/Posts/Posts'
import { headerHost } from '../../lib/guard'
import { AttachmentData } from '../../lib/models/attachment'
import { StatusData } from '../../lib/models/status'
import { getFirstValueFromParsedQuery } from '../../lib/query'
import { getStorage } from '../../lib/storage'
import styles from './index.module.scss'

interface Props {
  status: StatusData
  replies: StatusData[]
  previouses: StatusData[]
  serverTime: number
}

const Page: NextPage<Props> = ({ status, replies, serverTime, previouses }) => {
  const { data: session } = useSession()
  const [modalMedia, setModalMedia] = useState<AttachmentData>()

  return (
    <main>
      <Head>
        <title>Activities: Actor</title>
      </Head>
      <Header session={session} />
      <section className="container pt-4">
        <Posts currentTime={new Date(serverTime)} statuses={previouses} />
        <section className="card p-4">
          <Post
            currentTime={new Date(serverTime)}
            status={status}
            onShowAttachment={(attachment: AttachmentData) =>
              setModalMedia(attachment)
            }
          />
        </section>
        <Posts currentTime={new Date(serverTime)} statuses={replies} />
      </section>
      <Modal
        isOpen={Boolean(modalMedia)}
        onRequestClose={() => setModalMedia(undefined)}
      >
        <Media
          showVideoControl
          className={cn(styles.media)}
          attachment={modalMedia}
        />
      </Modal>
    </main>
  )
}

type Params = {
  actor: string
  status: string
}

export const getServerSideProps: GetServerSideProps<Props, Params> = async ({
  req,
  query
}) => {
  const storage = await getStorage()
  if (!storage) throw new Error('Storage is not available')

  const actor = getFirstValueFromParsedQuery(query.actor)
  const id = getFirstValueFromParsedQuery(query.status)
  const host = getFirstValueFromParsedQuery(headerHost(req.headers))

  if (!actor || !id || !host) return { notFound: true }

  const statusId = `https://${host}/users/${actor.slice(1)}/statuses/${id}`
  const [status, replies] = await Promise.all([
    storage.getStatus({ statusId, withReplies: false }),
    storage.getStatusReplies({ statusId })
  ])
  if (!status) {
    return { notFound: true }
  }

  const previouses = []
  if (status.reply) {
    let replyStatus = await storage.getStatus({
      statusId: status.reply,
      withReplies: false
    })
    while (previouses.length < 5 && replyStatus) {
      previouses.push(replyStatus.toJson())
      if (!replyStatus.reply) {
        replyStatus = undefined
        continue
      }
      replyStatus = await storage.getStatus({
        statusId: replyStatus.reply,
        withReplies: false
      })
    }
  }

  return {
    props: {
      status: status.toJson(),
      previouses,
      replies: replies.map((status) => status.toJson()),
      serverTime: Date.now()
    }
  }
}

export default Page
