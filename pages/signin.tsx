/* eslint-disable camelcase */
import { GetServerSideProps, NextPage } from 'next'
import { getServerSession } from 'next-auth/next'
import { getCsrfToken } from 'next-auth/react'
import Head from 'next/head'

import { Button } from '../lib/components/Button'
import { Header } from '../lib/components/Header'
import { Posts } from '../lib/components/Posts/Posts'
import { getConfig } from '../lib/config'
import { StatusData } from '../lib/models/status'
import { getStorage } from '../lib/storage'
import { Timeline } from '../lib/timelines/types'
import { authOptions } from './api/auth/[...nextauth]'

interface Props {
  host: string
  currentServerTime: number
  csrfToken?: string
  statuses?: StatusData[]
}

const Page: NextPage<Props> = ({
  csrfToken,
  host,
  statuses,
  currentServerTime
}) => {
  return (
    <main>
      <Head>
        <title>Activities: signin</title>
      </Head>
      <Header />
      <section className="container pt-4">
        <div className="col-12">
          <h1 className="mb-4">Local public timeline</h1>
          <form action={`https://${host}/api/auth/signin/github`} method="POST">
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <input
              type="hidden"
              name="callbackUrl"
              value={`https://${host}/api/auth/callback/github`}
            />
            <Button outline type="submit">
              Sign in with Github
            </Button>
          </form>
          <Posts
            currentTime={new Date(currentServerTime)}
            statuses={statuses ?? []}
          />
        </div>
      </section>
    </main>
  )
}

export const getServerSideProps: GetServerSideProps<Props> = async ({
  req,
  res
}) => {
  const session = await getServerSession(req, res, authOptions)
  if (session?.user) {
    return {
      redirect: {
        destination: '/',
        permanent: false
      }
    }
  }

  const config = getConfig()
  const [csrfToken, storage] = await Promise.all([
    getCsrfToken({ req }),
    getStorage()
  ])

  const statuses = await storage?.getTimeline({
    timeline: Timeline.LocalPublic
  })

  return {
    props: {
      csrfToken,
      currentServerTime: Date.now(),
      host: req.headers.host || config.host,
      statuses: statuses?.map((status) => status.toJson())
    }
  }
}

export default Page
