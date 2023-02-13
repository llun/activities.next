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
import { headerHost } from '../../lib/guard'
import { AttachmentData } from '../../lib/models/attachment'
import { StatusData } from '../../lib/models/status'
import { getFirstValueFromParsedQuery } from '../../lib/query'
import { getStorage } from '../../lib/storage'
import styles from './index.module.scss'

interface Props {
  status: StatusData
  replies: StatusData[]
}

const Page: NextPage<Props> = ({ status }) => {
  const { data: session } = useSession()
  const [currentTime] = useState<number>(Date.now())
  const [modalMedia, setModalMedia] = useState<AttachmentData>()

  return (
    <main>
      <Head>
        <title>Activities: Actor</title>
      </Head>
      <Header session={session} />
      <section className="container pt-4">
        <section className="card p-4">
          <Post
            showActorId
            currentTime={new Date(currentTime)}
            status={status}
            onShowAttachment={(attachment: AttachmentData) =>
              setModalMedia(attachment)
            }
          />
        </section>
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
    storage.getStatus({ statusId }),
    storage.getStatusReplies({ statusId })
  ])
  if (!status) {
    return { notFound: true }
  }

  return {
    props: {
      status: status.toJson(),
      replies: replies.map((status) => status.toJson())
    }
  }
}

export default Page
