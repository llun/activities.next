/* eslint-disable camelcase */
import { GetStaticPaths, GetStaticProps, NextPage } from 'next'
import { useSession } from 'next-auth/react'
import Head from 'next/head'
import { useState } from 'react'

import { Header } from '../../lib/components/Header'
import { Modal } from '../../lib/components/Modal'
import { Media } from '../../lib/components/Posts/Media'
import { Post } from '../../lib/components/Posts/Post'
import { Posts } from '../../lib/components/Posts/Posts'
import { AttachmentData } from '../../lib/models/attachment'
import { StatusData } from '../../lib/models/status'
import { getFirstValueFromParsedQuery } from '../../lib/query'
import { getStorage } from '../../lib/storage'
import styles from './[status].module.scss'

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
        <Posts
          className="mt-4"
          currentTime={new Date(serverTime)}
          statuses={previouses}
        />
        <section className={styles.highlight}>
          <Post
            currentTime={new Date(serverTime)}
            status={status}
            onShowAttachment={(attachment: AttachmentData) =>
              setModalMedia(attachment)
            }
          />
        </section>
        <Posts
          className="mt-4"
          currentTime={new Date(serverTime)}
          statuses={replies}
        />
      </section>
      <Modal
        isOpen={Boolean(modalMedia)}
        onRequestClose={() => setModalMedia(undefined)}
      >
        <Media showVideoControl attachment={modalMedia} />
      </Modal>
    </main>
  )
}

type Params = {
  actor: string
  status: string
}

export const getStaticProps: GetStaticProps<Props, Params> = async (
  context
) => {
  const query = context.params
  if (!query?.actor) return { notFound: true }
  if (!query?.status) return { notFound: true }

  const storage = await getStorage()
  if (!storage) throw new Error('Storage is not available')

  const actor = getFirstValueFromParsedQuery(query.actor)
  const id = getFirstValueFromParsedQuery(query.status)

  const parts = (actor as string).split('@').slice(1)
  if (parts.length !== 2) {
    return { notFound: true }
  }

  const statusId = `https://${parts[1]}/users/${parts[0]}/statuses/${id}`
  const [status, replies] = await Promise.all([
    storage.getStatus({ statusId, withReplies: false }),
    storage.getStatusReplies({ statusId })
  ])
  if (!status) {
    return { notFound: true, revalidate: 5 }
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

  return {
    props: {
      status: status.toJson(),
      previouses: previouses.reverse(),
      replies: replies.map((status) => status.toJson()),
      serverTime: Date.now()
    },
    revalidate: 30
  }
}

export const getStaticPaths: GetStaticPaths = async () => {
  return {
    paths: [],
    fallback: 'blocking'
  }
}

export default Page
