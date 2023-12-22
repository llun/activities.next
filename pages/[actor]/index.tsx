/* eslint-disable camelcase */
import cn from 'classnames'
import { GetServerSideProps, NextPage } from 'next'
import { getServerSession } from 'next-auth'
import { useSession } from 'next-auth/react'
import Head from 'next/head'
import { useState } from 'react'

import { authOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import {
  PublicProfile,
  getActorPosts,
  getPublicProfileFromHandle
} from '@/lib/activities'
import { ActorAttachments } from '@/lib/components/ActorAttachments'
import { ActorTab, ActorTabs } from '@/lib/components/ActorTab'
import { FollowAction } from '@/lib/components/FollowAction'
import { Header } from '@/lib/components/Header'
import { Posts } from '@/lib/components/Posts/Posts'
import { Profile } from '@/lib/components/Profile'
import { CACHE_KEY_PREFIX_ACTOR, CACHE_NAMESPACE_ACTORS } from '@/lib/constants'
import { AttachmentData } from '@/lib/models/attachment'
import { StatusData } from '@/lib/models/status'
import { getStorage } from '@/lib/storage'
import { cache } from '@/lib/utils/cache'
import { getFirstValueFromParsedQuery } from '@/lib/utils/getFirstValueFromParsedQuery'

import styles from './index.module.scss'

interface Props {
  person: PublicProfile
  statuses: StatusData[]
  attachments: AttachmentData[]
  serverTime: number
}

const Page: NextPage<Props> = ({
  person,
  statuses,
  attachments,
  serverTime
}) => {
  const { data: session } = useSession()
  const isLoggedIn = Boolean(session?.user?.email)
  const [currentTab, setCurrentTab] = useState<ActorTab>(ActorTab.Posts)

  return (
    <main>
      <Head>
        <title>Activities: Actor</title>
      </Head>
      <Header session={session} />
      <section className="container pt-4">
        <section className="card">
          <div className="card-body d-flex flex-column flex-sm-row">
            {person.icon?.url && (
              <img
                alt="Actor icon"
                className={cn(styles.icon, 'me-4', 'mb-2', 'flex-shrink-0')}
                src={person.icon?.url}
              />
            )}
            <Profile
              className="flex-fill"
              name={person.name}
              url={person.url}
              username={person.username}
              domain={person.domain}
              totalPosts={person.totalPosts}
              followersCount={person.followersCount}
              followingCount={person.followingCount}
              createdAt={person.createdAt}
            />
            <FollowAction targetActorId={person.id} isLoggedIn={isLoggedIn} />
          </div>
        </section>
        {attachments.length > 0 && (
          <ActorTabs
            currentTab={currentTab}
            onClickTab={async (tab) => {
              setCurrentTab(tab)
            }}
          />
        )}
        {currentTab === ActorTab.Posts && (
          <Posts
            className={attachments.length > 0 ? 'mt-2' : 'mt-4'}
            currentTime={new Date(serverTime)}
            statuses={statuses}
          />
        )}
        {currentTab === ActorTab.Medias && (
          <ActorAttachments className="mt-2" attachments={attachments} />
        )}
      </section>
    </main>
  )
}

type Params = {
  actor: string
}

export const getServerSideProps: GetServerSideProps<Props, Params> = async ({
  req,
  res,
  query
}) => {
  const actor = getFirstValueFromParsedQuery(query.actor)
  if (!actor) return { notFound: true }

  const [storage, session] = await Promise.all([
    getStorage(),
    getServerSession(req, res, authOptions)
  ])
  if (!storage) throw new Error('Storage is not available')

  const parts = (actor as string).split('@').slice(1)
  if (parts.length !== 2) {
    return { notFound: true }
  }

  const [username, domain] = parts
  const isLoggedIn = Boolean(session?.user?.email)
  const localActor = await storage.getActorFromUsername({ username, domain })
  if (!isLoggedIn && !localActor?.account) {
    return { notFound: true }
  }

  if (localActor?.account) {
    const props = await cache(
      CACHE_NAMESPACE_ACTORS,
      `${CACHE_KEY_PREFIX_ACTOR}_${actor}`,
      async () => {
        const [
          statuses,
          statusCount,
          attachments,
          followingCount,
          followersCount
        ] = await Promise.all([
          storage.getActorStatuses({ actorId: localActor.id }),
          storage.getActorStatusesCount({ actorId: localActor.id }),
          storage.getAttachmentsForActor({ actorId: localActor.id }),
          storage.getActorFollowingCount({ actorId: localActor.id }),
          storage.getActorFollowersCount({ actorId: localActor.id })
        ])
        return {
          person: localActor.toPublicProfile({
            followersCount,
            followingCount,
            totalPosts: statusCount
          }),
          statuses: statuses.map((item) => item.toJson()),
          attachments: attachments.map((item) => item.toJson()),
          serverTime: Date.now()
        }
      }
    )
    return { props: { ...props, serverTime: Date.now() } }
  }

  const person = await getPublicProfileFromHandle(actor, true)
  if (!person) {
    return { notFound: true }
  }

  const props = await cache(
    CACHE_NAMESPACE_ACTORS,
    `${CACHE_KEY_PREFIX_ACTOR}_${actor}`,
    async () => {
      const [statuses, attachments] = await Promise.all([
        getActorPosts({ postsUrl: person.urls?.posts }),
        storage.getAttachmentsForActor({ actorId: person.id })
      ])
      return {
        person,
        statuses,
        attachments: attachments.map((item) => item.toJson()),
        serverTime: Date.now()
      }
    }
  )
  return {
    props: { ...props, serverTime: Date.now() }
  }
}

export default Page
