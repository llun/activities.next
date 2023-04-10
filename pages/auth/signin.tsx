import type {
  GetServerSidePropsContext,
  InferGetServerSidePropsType
} from 'next'
import { getServerSession } from 'next-auth/next'
import { getProviders, signIn } from 'next-auth/react'
import Head from 'next/head'

import { Button } from '../../lib/components/Button'
import { Header } from '../../lib/components/Header'
import { Posts } from '../../lib/components/Posts/Posts'
import { getStorage } from '../../lib/storage'
import { Timeline } from '../../lib/timelines/types'
import { authOptions } from '../api/auth/[...nextauth]'

export default function SignIn({
  providers,
  statuses,
  currentServerTime
}: InferGetServerSidePropsType<typeof getServerSideProps>) {
  return (
    <main>
      <Head>
        <title>Activities: signin</title>
      </Head>
      <Header />
      <section className="container pt-4">
        <div className="col-12">
          <h1 className="mb-4">Local public timeline</h1>
          {Object.values(providers).map((provider) => (
            <div key={provider.name}>
              <Button onClick={() => signIn(provider.id)}>
                Sign in with {provider.name}
              </Button>
            </div>
          ))}
          <Posts
            currentTime={new Date(currentServerTime)}
            statuses={statuses ?? []}
          />
        </div>
      </section>
    </main>
  )
}

export async function getServerSideProps(context: GetServerSidePropsContext) {
  const session = await getServerSession(context.req, context.res, authOptions)
  if (session) {
    return { redirect: { destination: '/' } }
  }

  const [storage, providers] = await Promise.all([getStorage(), getProviders()])
  const statuses = await storage?.getTimeline({
    timeline: Timeline.LocalPublic
  })

  return {
    props: {
      providers: providers ?? [],
      currentServerTime: Date.now(),
      statuses: statuses?.map((status) => status.toJson())
    }
  }
}
