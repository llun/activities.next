/* eslint-disable camelcase */
import cn from 'classnames'
import { GetServerSideProps, NextPage } from 'next'
import { getServerSession } from 'next-auth/next'
import { useSession } from 'next-auth/react'
import Head from 'next/head'
import Image from 'next/image'
import { useEffect, useState } from 'react'

import { getTimeline } from '../lib/client'
import { Header } from '../lib/components/Header'
import { PostBox } from '../lib/components/PostBox/PostBox'
import { Posts } from '../lib/components/Posts/Posts'
import { Profile as ProfileComponent } from '../lib/components/Profile'
import { TimelineLoadMoreButton } from '../lib/components/TimelineLoadMoreButton'
import { getConfig } from '../lib/config'
import { Actor, ActorProfile } from '../lib/models/actor'
import { StatusData } from '../lib/models/status'
import { getStorage } from '../lib/storage'
import { Timeline } from '../lib/timelines/types'
import { authOptions } from './api/auth/[...nextauth]'
import styles from './index.module.scss'

interface Props {
  host: string
  currentServerTime: number
  statuses: StatusData[]
  profile: ActorProfile
}

const Page: NextPage<Props> = ({
  host,
  profile,
  statuses,
  currentServerTime
}) => {
  const { data: session } = useSession()
  const [replyStatus, setReplyStatus] = useState<StatusData>()
  const [currentStatuses, setCurrentStatuses] = useState<StatusData[]>(statuses)
  const [currentTime, setCurrentTime] = useState<number>(currentServerTime)
  const [isLoadingMoreStatuses, setLoadingMoreStatuses] =
    useState<boolean>(false)

  const onReply = (status: StatusData) => {
    setReplyStatus(status)
    window.scrollTo({ top: 0 })
  }

  const onPostDeleted = (status: StatusData) => {
    const statusIndex = currentStatuses.indexOf(status)
    setCurrentStatuses([
      ...currentStatuses.slice(0, statusIndex),
      ...currentStatuses.slice(statusIndex + 1)
    ])
  }

  useEffect(() => {
    setCurrentTime(Date.now())
  }, [currentStatuses])

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
            <ProfileComponent
              name={profile.name || ''}
              url={`https://${profile.domain}/${Actor.getMentionFromProfile(
                profile
              )}`}
              username={profile.username}
              domain={profile.domain}
              createdAt={profile.createdAt}
            />
          </div>
          <div className="col-12 col-md-9">
            <PostBox
              host={host}
              profile={profile}
              replyStatus={replyStatus}
              onDiscardReply={() => setReplyStatus(undefined)}
              onPostCreated={(status: StatusData) => {
                setCurrentStatuses((previousValue) => [
                  status,
                  ...previousValue
                ])
                setReplyStatus(undefined)
              }}
            />
            <Posts
              currentTime={new Date(currentTime)}
              statuses={currentStatuses}
              currentActor={profile}
              showActions
              onReply={onReply}
              onPostDeleted={onPostDeleted}
            />
            <TimelineLoadMoreButton
              disabled={isLoadingMoreStatuses}
              onClick={async () => {
                setLoadingMoreStatuses(true)
                const statuses = await getTimeline({
                  timeline: Timeline.MAIN,
                  startAfterStatusId:
                    currentStatuses[currentStatuses.length - 1].id
                })
                setCurrentStatuses([...currentStatuses, ...statuses])
                setLoadingMoreStatuses(false)
              }}
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
    getServerSession(req, res, authOptions)
  ])

  const config = getConfig()
  if (
    !session?.user?.email ||
    !config.allowEmails.includes(session?.user?.email || '') ||
    !storage
  ) {
    return {
      redirect: {
        destination: '/auth/signin',
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

  const actor = await storage.getActorFromEmail({ email: session.user.email })
  if (!actor) {
    return {
      redirect: {
        destination: '/auth/signin',
        permanent: false
      }
    }
  }

  const statuses = await storage.getTimeline({
    timeline: Timeline.MAIN,
    actorId: actor.id
  })
  return {
    props: {
      host: config.host,
      statuses: statuses.map((item) => item.toJson()),
      currentServerTime: Date.now(),
      profile: actor.toProfile()
    }
  }
}

export default Page
