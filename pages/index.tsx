/* eslint-disable camelcase */
import cn from 'classnames'
import format from 'date-fns/format'
import { GetServerSideProps, NextPage } from 'next'
import { unstable_getServerSession } from 'next-auth/next'
import { useSession } from 'next-auth/react'
import Head from 'next/head'
import Image from 'next/image'
import { useRef, useState } from 'react'

import { Header } from '../lib/components/Header'
import { PostBox } from '../lib/components/PostBox/PostBox'
import { Posts } from '../lib/components/Posts/Posts'
import { getConfig } from '../lib/config'
import {
  Profile,
  getAtWithHostFromId,
  getProfileFromActor,
  getUsernameFromId
} from '../lib/models/actor'
import { Attachment } from '../lib/models/attachment'
import { Status } from '../lib/models/status'
import { getStorage } from '../lib/storage'
import { authOptions } from './api/auth/[...nextauth]'
import styles from './index.module.scss'

interface Props {
  currentServerTime: number
  statuses: Status[]
  attachments: Attachment[]
  profile: Profile
}

const Page: NextPage<Props> = ({
  profile,
  statuses,
  attachments,
  currentServerTime
}) => {
  const { data: session } = useSession()
  const [replyStatus, setReplyStatus] = useState<Status>()
  const [currentStatuses, setCurrentStatuses] = useState<Status[]>(statuses)
  const postBoxRef = useRef<HTMLTextAreaElement>(null)

  const onReply = (status: Status) => {
    setReplyStatus(status)
    window.scrollTo({ top: 0 })

    if (!postBoxRef.current) return
    const postBox = postBoxRef.current

    const replyText = `${getAtWithHostFromId(status.actorId)} `
    postBox.value = replyText
    postBox.selectionStart = replyText.length
    postBox.selectionEnd = replyText.length
    postBox.focus()
  }

  return (
    <main>
      <Head>
        <title>Activities: timeline</title>
      </Head>
      <Header session={session} />
      <section className="container pt-4">
        <div className="row">
          <div className="col-12 col-md-3">
            {profile.iconUrl && (
              <Image
                width={100}
                height={100}
                alt="Actor icon"
                className={cn(styles.icon, 'me-4', 'mb-2', 'flex-shrink-0')}
                src={profile.iconUrl}
              />
            )}
            <div>
              <h1>{profile.name}</h1>
              <h4>@{getUsernameFromId(profile.id)}</h4>
              {Number.isInteger(profile.createdAt) && (
                <p>Joined {format(profile.createdAt, 'd MMM yyyy')}</p>
              )}
            </div>
          </div>
          <div className="col-12 col-md-9">
            <PostBox
              profile={profile}
              replyStatus={replyStatus}
              onDiscardReply={() => setReplyStatus(undefined)}
              onPostCreated={(status: Status) => {
                setCurrentStatuses((previousValue) => [
                  status,
                  ...previousValue
                ])
                setReplyStatus(undefined)
              }}
            />
            <Posts
              currentTime={new Date(currentServerTime)}
              statuses={currentStatuses}
              attachments={attachments}
              showActorId
              showActions
              onReply={onReply}
            />
          </div>
        </div>
      </section>
    </main>
  )
}

export const getServerSideProps: GetServerSideProps<Props> = async ({
  req,
  res
}) => {
  const [storage, session] = await Promise.all([
    getStorage(),
    unstable_getServerSession(req, res, authOptions)
  ])

  const config = getConfig()
  if (
    !session?.user?.email ||
    !config.allowEmails.includes(session?.user?.email || '') ||
    !storage
  ) {
    return {
      redirect: {
        destination: '/signin',
        permanent: false
      }
    }
  }

  const isAccountExists = await storage.isAccountExists({
    email: session?.user?.email
  })
  if (!isAccountExists) {
    return {
      redirect: {
        destination: '/setup',
        permanent: false
      }
    }
  }

  const [statuses, actor] = await Promise.all([
    storage.getStatuses(),
    storage.getActorFromEmail({ email: session.user.email })
  ])
  if (!actor) {
    return {
      redirect: {
        destination: '/signin',
        permanent: false
      }
    }
  }

  const statusesAttachments = await Promise.all(
    statuses.map((status) => storage.getAttachments({ statusId: status.id }))
  )

  return {
    props: {
      statuses,
      attachments: statusesAttachments.flat(),
      currentServerTime: Date.now(),
      profile: getProfileFromActor(actor)
    }
  }
}

export default Page
