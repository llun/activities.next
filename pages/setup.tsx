/* eslint-disable camelcase */
import { GetServerSideProps, NextPage } from 'next'
import { getServerSession } from 'next-auth/next'
import { useSession } from 'next-auth/react'
import Head from 'next/head'

import { Button } from '../lib/components/Button'
import { Header } from '../lib/components/Header'
import { getConfig } from '../lib/config'
import { getStorage } from '../lib/storage'
import { authOptions } from './api/auth/[...nextauth]'

interface Props {
  defaultHost: string
}

const Page: NextPage<Props> = ({ defaultHost }) => {
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
          <div className="mb-3">
            <label htmlFor="password" className="form-label">
              Password
            </label>
            <input
              type="password"
              className="form-control"
              id="password"
              name="password"
              aria-describedby="passwordHelp"
            />
            <div id="passwordHelp" className="form-text">
              User password
            </div>
          </div>
          <div className="mb-3">
            <label htmlFor="domain" className="form-label">
              Domain
            </label>
            <input
              type="text"
              className="form-control"
              id="domain"
              name="domain"
              defaultValue={defaultHost}
              aria-describedby="domainHelp"
            />
            <div id="domainHelp" className="form-text">
              Domain name for the actor
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
  const [session, storage] = await Promise.all([
    getServerSession(req, res, authOptions),
    getStorage()
  ])
  if (!session?.user || !session.user.email || !storage) {
    return {
      redirect: {
        destination: '/api/auth/signin',
        permanent: false
      }
    }
  }

  const config = getConfig()
  if (!config.allowEmails.includes(session.user.email)) {
    return {
      redirect: {
        destination: '/api/auth/signin',
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
    props: {
      defaultHost: config.host
    }
  }
}

export default Page
