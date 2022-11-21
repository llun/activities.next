import { GetServerSideProps, NextPage } from 'next'
import Head from 'next/head'
import Link from 'next/link'
import { unstable_getServerSession } from 'next-auth'
import { useSession } from 'next-auth/react'
import cn from 'classnames'

import { authOptions } from './api/auth/[...nextauth]'
import { Header } from '../lib/components/Header'
import { getPerson, getPosts } from '../lib/activities'

import styles from './[actor].module.scss'
import { Button } from '../lib/components/Button'
import { getStorage } from '../lib/storage'
import { getConfig } from '../lib/config'
import { Posts } from '../lib/components/Posts/Posts'
import { Status } from '../lib/models/status'

interface Props {
  isLoggedIn: boolean
  isFollowing: boolean
  username: string
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
  isLoggedIn,
  isFollowing,
  username,
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
              <h1>@{username}</h1>
              <small>
                <Link href={url} target={'_blank'}>
                  {url}
                </Link>
              </small>
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
                  <Button
                    onClick={() => {
                      fetch('/api/v1/accounts/follow', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ target: id })
                      })
                    }}
                  >
                    Follow
                  </Button>
                )}
                {isFollowing && (
                  <Button
                    variant="danger"
                    onClick={() => {
                      fetch('/api/v1/accounts/unfollow', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ target: id })
                      })
                    }}
                  >
                    Unfollow
                  </Button>
                )}
              </div>
            )}
          </div>
        </section>
        <Posts statuses={posts} />
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
  const actorId = `https://${domain}/users/${account}`
  const person = await getPerson(actorId, true)

  if (!person) {
    return { notFound: true }
  }

  if (!(session?.user && session?.user?.email)) {
    const posts = await getPosts(person.urls?.posts)
    return {
      props: {
        isLoggedIn: false,
        isFollowing: false,
        id: person.id,
        username: person.username,
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
      isLoggedIn: true,
      isFollowing,
      id: person.id,
      username: person.username,
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
