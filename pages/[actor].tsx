import { GetServerSideProps, NextPage } from 'next'
import Head from 'next/head'
import Link from 'next/link'
import { useSession } from 'next-auth/react'

import { Header } from '../lib/components/Header'
import { getPerson } from '../lib/activities'

interface Props {
  handle: string
  iconUrl: string
  url: string
  followersCount: number
  followingCount: number
  createdAt: number
}

const Page: NextPage<Props> = ({ handle, url }) => {
  const { data: session } = useSession()
  return (
    <main>
      <Head>
        <title>Activities: Actor</title>
      </Head>
      <Header session={session} />
      <section className="container pt-4">
        <section className="w-full grid grid-cols-1">
          <h1>@{handle}</h1>
          <small>
            <Link href={url} target={'_blank'}>
              {url}
            </Link>
          </small>
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
    return {
      props: {
        handle: person.handle,
        iconUrl: person.icon?.url || '',
        url: person.url,
        followersCount: person.followersCount,
        followingCount: person.followingCount,
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
      followersCount: 0,
      followingCount: 0,
      createdAt: 0
    }
  }
}

export default Page
