import { GetServerSideProps, NextPage } from 'next'
import Head from 'next/head'
import Link from 'next/link'
import { unstable_getServerSession } from 'next-auth'
import { useSession } from 'next-auth/react'
import parse, { attributesToProps } from 'html-react-parser'
import cn from 'classnames'
import formatDistanceToNow from 'date-fns/formatDistanceToNow'

import { authOptions } from './api/auth/[...nextauth]'
import { Header } from '../lib/components/Header'
import { getPerson, getPosts } from '../lib/activities'

import styles from './[actor].module.scss'

interface Props {
  handle: string
  iconUrl?: string
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
  handle,
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
          <div className="card-body d-flex">
            {iconUrl && (
              <img className={cn(styles.icon, 'me-2')} src={iconUrl} />
            )}
            <div>
              <h1>@{handle}</h1>
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
  const session = await unstable_getServerSession(req, res, authOptions)
  if (!session?.user) {
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
    const person = await getPerson(`https://${domain}/users/${account}`)
    if (!person) {
      return { notFound: true }
    }

    const posts = person.totalPosts > 0 ? await getPosts(person.urls.posts) : []

    return {
      props: {
        handle: person.handle,
        iconUrl: person.icon?.url || '',
        url: person.url,
        totalPosts: person.totalPosts,
        followersCount: person.followersCount,
        followingCount: person.followingCount,
        posts,
        createdAt: person.createdAt
      }
    }
  }

  // Internal Account
  return {
    props: {
      handle: '',
      iconUrl: '',
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
