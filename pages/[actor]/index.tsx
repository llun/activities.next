/* eslint-disable camelcase */
import cn from 'classnames'
import { GetStaticPaths, GetStaticProps, NextPage } from 'next'
import { useSession } from 'next-auth/react'
import Head from 'next/head'
import { useEffect, useState } from 'react'

import {
  PublicProfile,
  getActorPosts,
  getPublicProfileFromHandle
} from '../../lib/activities'
import { isFollowing } from '../../lib/client'
import { ActorAttachments } from '../../lib/components/ActorAttachments'
import { ActorTab, ActorTabs } from '../../lib/components/ActorTab'
import { FollowAction } from '../../lib/components/FollowAction'
import { Header } from '../../lib/components/Header'
import { Posts } from '../../lib/components/Posts/Posts'
import { Profile } from '../../lib/components/Profile'
import { AttachmentData } from '../../lib/models/attachment'
import { StatusData } from '../../lib/models/status'
import { getFirstValueFromParsedQuery } from '../../lib/query'
import { getStorage } from '../../lib/storage'
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
  const [followingStatus, setFollowingStatus] = useState<boolean | undefined>()
  const isLoggedIn = Boolean(session?.user?.email)
  const [currentTab, setCurrentTab] = useState<ActorTab>(ActorTab.Posts)

  useEffect(() => {
    if (isLoggedIn) {
      isFollowing({ targetActorId: person.id }).then(setFollowingStatus)
    }
  }, [person, isLoggedIn])

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
            <FollowAction
              targetActorId={person.id}
              isLoggedIn={isLoggedIn}
              followingStatus={followingStatus}
            />
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

export const getStaticProps: GetStaticProps<Props, Params> = async (
  context
) => {
  const query = context.params
  if (!query?.actor) return { notFound: true, revalidate: 5 }

  const actor = getFirstValueFromParsedQuery(query?.actor)
  if (!actor) return { notFound: true, revalidate: 5 }

  const storage = await getStorage()
  if (!storage) throw new Error('Storage is not available')

  const parts = (actor as string).split('@').slice(1)
  if (parts.length !== 2) {
    return { notFound: true, revalidate: 5 }
  }

  const [username, domain] = parts
  const person = await getPublicProfileFromHandle(`${username}@${domain}`, true)
  if (!person) {
    return { notFound: true, revalidate: 5 }
  }

  try {
    const [statuses, attachments] = await Promise.all([
      getActorPosts({ postsUrl: person.urls?.posts }),
      storage.getAttachmentsForActor({ actorId: person.id })
    ])
    return {
      props: {
        person,
        statuses,
        attachments: attachments.map((item) => item.toJson()),
        serverTime: Date.now()
      },
      revalidate: 600
    }
  } catch {
    return { notFound: true, revalidate: 5 }
  }
}

export const getStaticPaths: GetStaticPaths = async () => {
  return {
    paths: [],
    fallback: 'blocking'
  }
}

export default Page
