/* eslint-disable camelcase */
import cn from 'classnames'
import { GetStaticProps, NextPage } from 'next'
import { useSession } from 'next-auth/react'
import Head from 'next/head'
import { useEffect, useState } from 'react'

import {
  PublicProfile,
  getActorPosts,
  getPersonFromHandle
} from '../../lib/activities'
import { isFollowing } from '../../lib/client'
import { FollowAction } from '../../lib/components/FollowAction'
import { Header } from '../../lib/components/Header'
import { Posts } from '../../lib/components/Posts/Posts'
import { Profile } from '../../lib/components/Profile'
import { getConfig } from '../../lib/config'
import { StatusData } from '../../lib/models/status'
import { getStorage } from '../../lib/storage'
import styles from './index.module.scss'

interface Props {
  person: PublicProfile
  statuses: StatusData[]
}

const Page: NextPage<Props> = ({ person, statuses }) => {
  const { data: session } = useSession()
  const [currentTime] = useState<number>(Date.now())
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
        <Posts currentTime={new Date(currentTime)} statuses={statuses} />
      </section>
    </main>
  )
}

type Params = {
  actor: string
}
export const getStaticProps: GetStaticProps<Props, Params> = async ({
  params
}) => {
  const actor = params?.actor
  const parts = (actor as string).split('@').slice(1)

  const storage = await getStorage()
  if (!storage || !actor || parts.length < 1 || parts.length > 2) {
    return { notFound: true }
  }

  if (parts.length === 1) {
    parts.push(getConfig().host)
  }

  const [username, domain] = parts
  const person = await getPersonFromHandle(`${username}@${domain}`, true)
  if (!person) {
    return { notFound: true }
  }

  const statuses = await getActorPosts({ postsUrl: person.urls?.posts })
  return {
    props: {
      person,
      statuses
    },
    // Revalidate page every 10 minutes
    revalidate: 600
  }
}

export async function getStaticPaths() {
  return {
    paths: [],
    fallback: 'blocking'
  }
}

export default Page
