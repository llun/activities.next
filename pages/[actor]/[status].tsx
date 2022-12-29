/* eslint-disable camelcase */
import cn from 'classnames'
import { GetStaticProps, NextPage } from 'next'
import { useSession } from 'next-auth/react'
import Head from 'next/head'
import { useState } from 'react'

import { Header } from '../../lib/components/Header'
import { Modal } from '../../lib/components/Modal'
import { Media } from '../../lib/components/Posts/Media'
import { Post } from '../../lib/components/Posts/Post'
import { getConfig } from '../../lib/config'
import { AttachmentData } from '../../lib/models/attachment'
import { StatusData } from '../../lib/models/status'
import { getStorage } from '../../lib/storage'
import styles from './index.module.scss'

interface Props {
  status: StatusData
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
export const getStaticProps: GetStaticProps<Props, Params> = async ({
  params
}) => {
  const actor = params?.actor
  const storage = await getStorage()
  if (!storage || !actor) {
    return { notFound: true }
  }

  const status = await storage.getStatus({
    statusId: `https://${getConfig().host}/users/${actor.slice(1)}/statuses/${
      params.status
    }`
  })
  if (!status) {
    return { notFound: true }
  }

  return {
    props: {
      status: status.toJson()
    },
    // Revalidate page every 6 hours
    revalidate: 21_600
  }
}

export async function getStaticPaths() {
  return {
    paths: [],
    fallback: 'blocking'
  }
}

export default Page
