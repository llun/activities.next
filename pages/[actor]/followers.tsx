/* eslint-disable camelcase */
import cn from 'classnames'
import { GetStaticProps, NextPage } from 'next'
import { useSession } from 'next-auth/react'
import Head from 'next/head'
import { useEffect, useState } from 'react'

import {
  PublicProfile,
  getPublicProfile,
  getWebfingerSelf
} from '../../lib/activities'
import { isFollowing } from '../../lib/client'
import { FollowAction } from '../../lib/components/FollowAction'
import { Header } from '../../lib/components/Header'
import { Profile } from '../../lib/components/Profile'
import { getConfig } from '../../lib/config'
import { getStorage } from '../../lib/storage'
import styles from './index.module.scss'

interface Props {
  person: PublicProfile
}

const Page: NextPage<Props> = ({ person }) => {
  const { data: session } = useSession()
  const [followingStatus, setFollowingStatus] = useState<boolean | undefined>()
  const isLoggedIn = Boolean(session?.user?.email)
  useEffect(() => {
    isFollowing({ targetActorId: person.id }).then(setFollowingStatus)
  }, [person])

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
  const storage = await getStorage()
  if (!storage) {
    return {
      redirect: {
        destination: '/signin',
        permanent: false
      }
    }
  }

  if (!params) {
    return { notFound: true }
  }

  const { actor } = params
  if (!actor) {
    return { notFound: true }
  }

  const parts = (actor as string).split('@').slice(1)
  if (parts.length < 1 || parts.length > 2) {
    return { notFound: true }
  }

  if (parts.length === 1) {
    parts.push(getConfig().host)
  }

  const [account, domain] = parts
  const actorId = await getWebfingerSelf(`${account}@${domain}`)
  if (!actorId) {
    return { notFound: true }
  }

  const person = await getPublicProfile({
    id: actorId,
    withCollectionCount: true
  })
  if (!person) {
    return { notFound: true }
  }

  return {
    props: {
      person
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
