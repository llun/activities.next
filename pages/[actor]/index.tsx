/* eslint-disable camelcase */
import cn from 'classnames'
import { GetStaticProps, NextPage } from 'next'
import { useSession } from 'next-auth/react'
import Head from 'next/head'
import { useState } from 'react'

import { getPerson, getPosts, getWebfingerSelf } from '../../lib/activities'
import { Button } from '../../lib/components/Button'
import { Header } from '../../lib/components/Header'
import { Posts } from '../../lib/components/Posts/Posts'
import { Profile } from '../../lib/components/Profile'
import { getConfig } from '../../lib/config'
import { StatusData } from '../../lib/models/status'
import { getStorage } from '../../lib/storage'
import styles from './index.module.scss'

interface Props {
  name: string
  iconUrl?: string
  id: string
  url: string
  followersCount: number
  followingCount: number
  totalPosts: number
  statuses: StatusData[]
  createdAt: number
}

const Page: NextPage<Props> = ({
  name,
  id,
  url,
  iconUrl,
  followersCount,
  followingCount,
  totalPosts,
  statuses,
  createdAt
}) => {
  const { data: session } = useSession()
  const [currentTime] = useState<number>(Date.now())
  const isLoggedIn = Boolean(session?.user?.email)

  return (
    <main>
      <Head>
        <title>Activities: Actor</title>
      </Head>
      <Header session={session} />
      <section className="container pt-4">
        <section className="card">
          <div className="card-body d-flex flex-column flex-sm-row">
            {iconUrl && (
              <img
                alt="Actor icon"
                className={cn(styles.icon, 'me-4', 'mb-2', 'flex-shrink-0')}
                src={iconUrl}
              />
            )}
            <Profile
              className="flex-fill"
              name={name}
              url={url}
              id={id}
              totalPosts={totalPosts}
              followersCount={followersCount}
              followingCount={followingCount}
              createdAt={createdAt}
            />
            {isLoggedIn && (
              <div className="flex-shrink-0">
                {/* TODO: Add api to check following status later */}
                <form action="/api/v1/accounts/follow" method="post">
                  <input type="hidden" name="target" value={id} />
                  <Button type="submit">Follow</Button>
                </form>
              </div>
            )}
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

  const person = await getPerson(actorId, true)
  if (!person) {
    return { notFound: true }
  }

  const statuses = await getPosts(person.urls?.posts)
  return {
    props: {
      id: person.id,
      name: person.name,
      iconUrl: person.icon?.url || '',
      url: person.url,
      totalPosts: person.totalPosts || 0,
      followersCount: person.followersCount || 0,
      followingCount: person.followingCount || 0,
      statuses,
      createdAt: person.createdAt
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
