import type {
  GetServerSidePropsContext,
  InferGetServerSidePropsType
} from 'next'
import { getServerSession } from 'next-auth'
import { getCsrfToken, getProviders, signIn } from 'next-auth/react'
import Head from 'next/head'
import Link from 'next/link'

import { Button } from '../../lib/components/Button'
import { Header } from '../../lib/components/Header'
import { Posts } from '../../lib/components/Posts/Posts'
import { getStorage } from '../../lib/storage'
import { Timeline } from '../../lib/timelines/types'
import { authOptions } from '../api/auth/[...nextauth]'

export default function SignIn({
  csrfToken,
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
          <div className="mb-4">
            <h1 className="mb-4">Sign-in</h1>
            {Object.values(providers).map((provider) => {
              if (provider.id === 'credentials') {
                return (
                  <div key={provider.name} className="mb-2">
                    <form method="post" action="/api/auth/callback/credentials">
                      <input
                        name="csrfToken"
                        type="hidden"
                        defaultValue={csrfToken}
                      />
                      <div className="mb-3 row">
                        <label
                          htmlFor="inputUsername"
                          className="col-sm-2 col-form-label"
                        >
                          Username
                        </label>
                        <div className="col-sm-10">
                          <input
                            name="username"
                            type="text"
                            className="form-control"
                            id="inputUsername"
                          />
                        </div>
                      </div>
                      <div className="mb-3 row">
                        <label
                          htmlFor="inputPassword"
                          className="col-sm-2 col-form-label"
                        >
                          Password
                        </label>
                        <div className="col-sm-10">
                          <input
                            name="password"
                            type="password"
                            className="form-control"
                            id="inputPassword"
                          />
                        </div>
                      </div>

                      <Button type="submit">
                        Sign in with {provider.name}
                      </Button>
                    </form>
                  </div>
                )
              }

              return (
                <div key={provider.name} className="mb-2">
                  <Button onClick={() => signIn(provider.id)}>
                    Sign in with {provider.name}
                  </Button>
                </div>
              )
            })}
            <Link href="/auth/register">Register</Link>
          </div>

          {statuses && statuses.length > 0 && (
            <div>
              <h2 className="mb-4">Local public timeline</h2>
              <Posts
                currentTime={new Date(currentServerTime)}
                statuses={statuses}
              />
            </div>
          )}
        </div>
      </section>
    </main>
  )
}

export async function getServerSideProps(context: GetServerSidePropsContext) {
  const session = await getServerSession(context.req, context.res, authOptions)
  if (session && session.user) {
    return { redirect: { destination: '/' } }
  }

  const [storage, providers, csrfToken] = await Promise.all([
    getStorage(),
    getProviders(),
    getCsrfToken(context)
  ])
  const statuses = await storage?.getTimeline({
    timeline: Timeline.LocalPublic
  })

  return {
    props: {
      csrfToken,
      providers: providers ?? [],
      currentServerTime: Date.now(),
      statuses: statuses?.map((status) => status.toJson())
    }
  }
}
