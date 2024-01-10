import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { getCsrfToken, getProviders } from 'next-auth/react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FC } from 'react'

import { authOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { Button } from '@/lib/components/Button'
import { Posts } from '@/lib/components/Posts/Posts'
import { getStorage } from '@/lib/storage'
import { Timeline } from '@/lib/timelines/types'

import { SigninButton } from './SigninButton'

export const metadata: Metadata = {
  title: 'Activities.next: Sign in'
}

const Page: FC = async () => {
  const [storage, providers, session, csrfToken] = await Promise.all([
    getStorage(),
    getProviders(),
    getServerSession(authOptions),
    getCsrfToken()
  ])

  if (!storage) throw new Error('Storage is not available')
  if (session && session.user) {
    return redirect('/')
  }

  const statuses = await storage?.getTimeline({
    timeline: Timeline.LOCAL_PUBLIC
  })

  return (
    <div className="col-12">
      <div className="mb-4">
        <h1 className="mb-4">Sign-in</h1>
        {Object.values(providers ?? []).map((provider) => {
          if (provider.id === 'credentials') {
            return (
              <div key={provider.name} className="mb-2">
                <form method="post" action="/api/auth/callback/credentials">
                  <input
                    name="csrfToken"
                    type="hidden"
                    defaultValue={csrfToken ?? ''}
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

                  <Button type="submit">Sign in with {provider.name}</Button>
                </form>
              </div>
            )
          }

          return <SigninButton key={provider.name} provider={provider} />
        })}
        <Link href="/auth/signup">Signup</Link>
      </div>

      {statuses && statuses.length > 0 && (
        <div>
          <h2 className="mb-4">Local public timeline</h2>
          <Posts
            className="mt-4"
            currentTime={new Date()}
            statuses={statuses?.map((status) => status.toJson())}
          />
        </div>
      )}
    </div>
  )
}

export default Page
