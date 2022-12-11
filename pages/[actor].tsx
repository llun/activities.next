/* eslint-disable camelcase */
import cn from 'classnames'
import format from 'date-fns/format'
import { GetStaticProps, NextPage } from 'next'
import { useSession } from 'next-auth/react'
import Head from 'next/head'
import Link from 'next/link'
import { useState } from 'react'

import { getPerson, getPosts, getWebfingerSelf } from '../lib/activities'
import { Button } from '../lib/components/Button'
import { Header } from '../lib/components/Header'
import { Posts } from '../lib/components/Posts/Posts'
import { getConfig } from '../lib/config'
import { getHostnameFromId, getUsernameFromId } from '../lib/models/actor'
import { Attachment } from '../lib/models/attachment'
import { Status } from '../lib/models/status'
import { getStorage } from '../lib/storage'
import styles from './[actor].module.scss'

interface Props {
  name: string
  iconUrl?: string
  id: string
  url: string
  followersCount: number
  followingCount: number
  totalPosts: number
  statuses: Status[]
  attachments: Attachment[]
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
  attachments,
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
                <p>Joined {format(createdAt, 'd MMM yyyy')}</p>
              )}
            </div>
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
        <Posts
          currentTime={new Date(currentTime)}
          statuses={statuses}
          attachments={attachments}
        />
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

  const posts = await getPosts(person.urls?.posts)
  const statuses = posts.map((item) => item[0])
  const attachments = posts.map((item) => item[1]).flat()
  console.log(attachments)

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
      attachments,
      createdAt: person.createdAt
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
