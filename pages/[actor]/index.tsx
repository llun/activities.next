/* eslint-disable camelcase */
import cn from 'classnames'
import { GetServerSideProps, NextPage } from 'next'
import { useSession } from 'next-auth/react'
import Head from 'next/head'
import { useEffect, useState } from 'react'

import {
  PublicProfile,
  getActorPosts,
  getPublicProfileFromHandle
} from '../../lib/activities'
import { isFollowing } from '../../lib/client'
import { FollowAction } from '../../lib/components/FollowAction'
import { Header } from '../../lib/components/Header'
import { Posts } from '../../lib/components/Posts/Posts'
import { Profile } from '../../lib/components/Profile'
import { headerHost } from '../../lib/guard'
import { StatusData } from '../../lib/models/status'
import { getFirstValueFromParsedQuery } from '../../lib/query'
import { getStorage } from '../../lib/storage'
import styles from './index.module.scss'

interface Props {
  person: PublicProfile
  statuses: StatusData[]
  serverTime: number
}

const Page: NextPage<Props> = ({ person, statuses, serverTime }) => {
  const { data: session } = useSession()
  const [followingStatus, setFollowingStatus] = useState<boolean | undefined>()
  const isLoggedIn = Boolean(session?.user?.email)

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
        <Posts currentTime={new Date(serverTime)} statuses={statuses} />
      </section>
    </main>
  )
}

type Params = {
  actor: string
}

export const getServerSideProps: GetServerSideProps<Props, Params> = async ({
  req,
  query
}) => {
  const actor = getFirstValueFromParsedQuery(query.actor)
  if (!actor) return { notFound: true }

  const storage = await getStorage()
  if (!storage) throw new Error('Storage is not available')

  const parts = (actor as string).split('@').slice(1)
  if (parts.length < 1 || parts.length > 2) {
    return { notFound: true }
  }

  if (parts.length === 1) {
    const host = getFirstValueFromParsedQuery(headerHost(req.headers))
    if (!host) return { notFound: true }
    parts.push(host)
  }

  const [username, domain] = parts
  const person = await getPublicProfileFromHandle(`${username}@${domain}`, true)
  if (!person) {
    return { notFound: true }
  }

  const statuses = await getActorPosts({ postsUrl: person.urls?.posts })
  return {
    props: {
      person,
      statuses,
      serverTime: Date.now()
    }
  }
}

export default Page
