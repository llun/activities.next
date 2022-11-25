/* eslint-disable camelcase */
import { GetServerSideProps, NextPage } from 'next'
import { unstable_getServerSession } from 'next-auth/next'
import { useSession } from 'next-auth/react'
import Head from 'next/head'

import { Button } from '../lib/components/Button'
import { Header } from '../lib/components/Header'
import { getConfig } from '../lib/config'
import { getStorage } from '../lib/storage'
import { authOptions } from './api/auth/[...nextauth]'

const Page: NextPage = () => {
  const { data: session } = useSession()
  return (
    <main>
      <Head>
        <title>Activities: setup</title>
      </Head>
      <Header session={session} />
      <section className="container pt-4">
        <form action="/api/v1/setup" method="post">
          <div className="mb-3">
            <label htmlFor="username" className="form-label">
              Username
            </label>
            <input
              type="text"
              className="form-control"
              id="username"
              name="username"
              aria-describedby="usernameHelp"
            />
            <div id="usernameHelp" className="form-text">
              Username name that will show before domain.
            </div>
          </div>
          <Button type="submit">Submit</Button>
        </form>
      </section>
    </main>
  )
}

export const getServerSideProps: GetServerSideProps<Props> = async ({
  req,
  res
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

  const config = getConfig()
  if (!config.allowEmails.includes(session?.user?.email || '')) {
    return {
      redirect: {
        destination: '/signin',
        permanent: false
      }
    }
  }

  const storage = await getStorage()
  if (!storage) {
    return {
      redirect: {
        destination: '/signin',
        permanent: false
      }
    }
  }

  if (await storage.isAccountExists({ email: session.user.email })) {
    return {
      redirect: {
        destination: '/',
        permanent: false
      }
    }
  }

  return {
    props: {}
  }
}

export default Page
