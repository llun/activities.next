/* eslint-disable camelcase */
import cn from 'classnames'
import { GetServerSideProps, NextPage } from 'next'
import { unstable_getServerSession } from 'next-auth'
import { useSession } from 'next-auth/react'
import Head from 'next/head'
import Link from 'next/link'

import { getPerson, getPosts, getWebfingerSelf } from '../lib/activities'
import { Button } from '../lib/components/Button'
import { Header } from '../lib/components/Header'
import { Posts } from '../lib/components/Posts/Posts'
import { getConfig } from '../lib/config'
import { getHostnameFromId, getUsernameFromId } from '../lib/models/actor'
import { Status } from '../lib/models/status'
import { getStorage } from '../lib/storage'
import styles from './[actor].module.scss'
import { authOptions } from './api/auth/[...nextauth]'

interface Props {
  currentServerTime: number
  isLoggedIn: boolean
  isFollowing: boolean
  name: string
  iconUrl?: string
  id: string
  url: string
  followersCount: number
  followingCount: number
  totalPosts: number
  posts: Status[]
  createdAt: number
}

const Page: NextPage<Props> = ({
  currentServerTime,
  isLoggedIn,
  isFollowing,
  name,
  id,
  url,
  iconUrl,
  followersCount,
  followingCount,
  totalPosts,
  posts,
  createdAt
}) => {
  const { data: session } = useSession()
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
            <div className="flex-fill">
              <h1>{name}</h1>
              <h4>
                <Link href={url} target={'_blank'}>
                  @{getUsernameFromId(id)}@{getHostnameFromId(id)}
                </Link>
              </h4>
              <p>
                <span>{totalPosts} Posts</span>
                <span className="ms-2">{followingCount} Following</span>
                <span className="ms-2">{followersCount} Followers</span>
              </p>
              {Number.isInteger(createdAt) && (
                <p>
                  Joined{' '}
                  {new Intl.DateTimeFormat('en-US', {
                    dateStyle: 'long',
                    timeStyle: 'short'
                  }).format(new Date(createdAt))}
                </p>
              )}
            </div>
            {isLoggedIn && (
              <div className="flex-shrink-0">
                {!isFollowing && (
                  <form action="/api/v1/accounts/follow" method="post">
                    <input type="hidden" name="target" value={id} />
                    <Button type="submit">Follow</Button>
                  </form>
                )}
                {isFollowing && (
                  <form action="/api/v1/accounts/unfollow" method="post">
                    <input type="hidden" name="target" value={id} />
                    <Button variant="danger" type="submit">
                      Unfollow
                    </Button>
                  </form>
                )}
              </div>
            )}
          </div>
        </section>
        <Posts currentTime={new Date(currentServerTime)} statuses={posts} />
      </section>
    </main>
  )
}

export const getServerSideProps: GetServerSideProps<Props> = async ({
  req,
  res,
  query
}) => {
  const [storage, session] = await Promise.all([
    getStorage(),
    unstable_getServerSession(req, res, authOptions)
  ])

  if (!storage) {
    return {
      redirect: {
        destination: '/signin',
        permanent: false
      }
    }
  }

  const { actor } = query
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

  if (!(session?.user && session?.user?.email)) {
    const posts = await getPosts(person.urls?.posts)
    return {
      props: {
        currentServerTime: Date.now(),
        isLoggedIn: false,
        isFollowing: false,
        id: person.id,
        name: person.name,
        iconUrl: person.icon?.url || '',
        url: person.url,
        totalPosts: person.totalPosts || 0,
        followersCount: person.followersCount || 0,
        followingCount: person.followingCount || 0,
        posts,
        createdAt: person.createdAt
      }
    }
  }

  const currentActor = await storage.getActorFromEmail({
    email: session.user.email || ''
  })

  if (!currentActor) {
    return { notFound: true }
  }

  const posts = await getPosts(person.urls?.posts)
  const isFollowing = await storage.isCurrentActorFollowing({
    currentActorId: currentActor.id,
    followingActorId: actorId
  })

  return {
    props: {
      currentServerTime: Date.now(),
      isLoggedIn: true,
      isFollowing,
      id: person.id,
      name: person.name,
      iconUrl: person.icon?.url || '',
      url: person.url,
      totalPosts: person.totalPosts || 0,
      followersCount: person.followersCount || 0,
      followingCount: person.followingCount || 0,
      posts,
      createdAt: person.createdAt
    }
  }
}

export default Page
