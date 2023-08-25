/* eslint-disable camelcase */
import cn from 'classnames'
import { GetServerSideProps, NextPage } from 'next'
import { getServerSession } from 'next-auth/next'
import { useSession } from 'next-auth/react'
import Head from 'next/head'
import Image from 'next/image'
import { Reducer, useEffect, useReducer, useState } from 'react'

import { getTimeline } from '../lib/client'
import { Header } from '../lib/components/Header'
import { PostBox } from '../lib/components/PostBox/PostBox'
import { Posts } from '../lib/components/Posts/Posts'
import { Profile as ProfileComponent } from '../lib/components/Profile'
import { TimelineLoadMoreButton } from '../lib/components/TimelineLoadMoreButton'
import { Tab, TimelineTabs } from '../lib/components/TimelineTabs'
import { getConfig } from '../lib/config'
import { Actor, ActorProfile } from '../lib/models/actor'
import { EditableStatusData, StatusData } from '../lib/models/status'
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

const TIMELINES_TABS: Tab[] = [
  { link: 'home', name: 'Home' },
  { link: 'no-announce', name: 'No Announces' }
]

const replyAction = (status: StatusData) => ({ type: 'reply' as const, status })
type ReplyAction = ReturnType<typeof replyAction>

const editAction = (status: EditableStatusData) => ({
  type: 'edit' as const,
  status
})
type EditAction = ReturnType<typeof editAction>

const clearAction = () => ({ type: 'clear' as const })
type ClearAction = ReturnType<typeof clearAction>

const statusActionReducer: Reducer<
  { replyStatus?: StatusData; editStatus?: EditableStatusData },
  ReplyAction | EditAction | ClearAction
> = (state, action) => {
  switch (action.type) {
    case 'edit':
      return { editStatus: action.status }
    case 'reply':
      return { replyStatus: action.status }
    default: {
      return {}
    }
  }
}

const Page: NextPage<Props> = ({
  host,
  profile,
  statuses,
  currentServerTime
}) => {
  const { data: session } = useSession()
  const [currentTab, setCurrentTab] = useState<Tab>(TIMELINES_TABS[0])
  const [statusActionState, dispatchStatusAction] = useReducer(
    statusActionReducer,
    {}
  )
  const [currentStatuses, setCurrentStatuses] = useState<StatusData[]>(statuses)
  const [currentTime, setCurrentTime] = useState<number>(currentServerTime)
  const [isLoadingMoreStatuses, setLoadingMoreStatuses] =
    useState<boolean>(false)

  const onReply = (status: StatusData) => {
    dispatchStatusAction(replyAction(status))
    window.scrollTo({ top: 0 })
  }

  const onEdit = (status: EditableStatusData) => {
    dispatchStatusAction(editAction(status))
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
              replyStatus={statusActionState.replyStatus}
              editStatus={statusActionState.editStatus}
              onDiscardReply={() => dispatchStatusAction(clearAction())}
              onPostCreated={(status: StatusData) => {
                setCurrentStatuses((previousValue) => [
                  status,
                  ...previousValue
                ])
                dispatchStatusAction(clearAction())
              }}
              onPostUpdated={(updatedStatus: StatusData) => {
                const index = currentStatuses.findIndex(
                  (status) => status.id === updatedStatus.id
                )
                // TODO: Update status in Timeline somehow.
                if (index >= 0) {
                  currentStatuses[index] = updatedStatus
                  setCurrentStatuses(() => currentStatuses)
                }
                dispatchStatusAction(clearAction())
              }}
            />
            <TimelineTabs
              currentTab={currentTab}
              tabs={TIMELINES_TABS}
              onClickTab={(tab) => {
                setCurrentTab(tab)
              }}
            />
            <Posts
              currentTime={new Date(currentTime)}
              statuses={currentStatuses}
              currentActor={profile}
              showActions
              onReply={onReply}
              onEdit={onEdit}
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

  if (!storage) {
    throw new Error('Fail to load storage')
  }

  const config = getConfig()
  if (!session?.user?.email) {
    return {
      redirect: {
        destination: '/auth/signin',
        permanent: false
      }
    }
  }

  if (
    config.allowEmails.length &&
    !config.allowEmails.includes(session.user.email)
  ) {
    return {
      redirect: {
        destination: '/auth/signin',
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
