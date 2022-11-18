import { GetServerSideProps, NextPage } from 'next'
import Head from 'next/head'
import Link from 'next/link'
import { unstable_getServerSession } from 'next-auth'
import { useSession } from 'next-auth/react'
import parse from 'html-react-parser'
import cn from 'classnames'
import formatDistanceToNow from 'date-fns/formatDistanceToNow'

import { authOptions } from './api/auth/[...nextauth]'
import { Header } from '../lib/components/Header'
import { getPerson, getPosts } from '../lib/activities'

import styles from './[actor].module.scss'
import { Button } from '../lib/components/Button'
import { getStorage } from '../lib/storage'

interface Props {
  isFollowing: boolean
  username: string
  iconUrl?: string
  id: string
  url: string
  followersCount: number
  followingCount: number
  totalPosts: number
  posts: {
    actor: string
    id: string
    url: string
    content: string
    createdAt: number
  }[]
  createdAt: number
}

const Page: NextPage<Props> = ({
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
              <p>
                Joined{' '}
                {new Intl.DateTimeFormat('en-US', {
                  dateStyle: 'long',
                  timeStyle: 'short'
                }).format(new Date(createdAt))}
              </p>
            </div>
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
          </div>
        </section>
        <section className="mt-4">
          {posts.map((post) => (
            <div key={post.id} className={cn('d-flex')}>
              <div className="flex-fill me-1">
                {parse(post.content, {
                  replace: (domNode: any) => {
                    if (domNode.attribs && domNode.name === 'a') {
                      domNode.attribs.target = '_blank'
                      return domNode
                    }

                    return domNode
                  }
                })}
              </div>
              <div className="flex-shrink-0">
                {formatDistanceToNow(post.createdAt)}
              </div>
            </div>
          ))}
        </section>
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
  if (!session?.user || !session?.user?.email || !storage) {
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
  if (parts.length < 1) {
    return { notFound: true }
  }

  // External Account
  if (parts.length === 2) {
    const [account, domain] = parts
    const actorId = `https://${domain}/users/${account}`
    const [currentActor, person] = await Promise.all([
      storage.getActorFromEmail(session.user.email),
      getPerson(actorId, true)
    ])

    if (!person || !currentActor) {
      return { notFound: true }
    }

    const posts =
      (person.totalPosts || 0) > 0 ? await getPosts(person.urls?.posts) : []
    const isFollowing = await storage.isCurrentActorFollowing(
      currentActor.id,
      actorId
    )

    return {
      props: {
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

  // Internal Account
  return {
    props: {
      isFollowing: false,
      username: '',
      iconUrl: '',
      id: '',
      url: '',
      totalPosts: 0,
      followersCount: 0,
      followingCount: 0,
      posts: [],
      createdAt: 0
    }
  }
}

export default Page
