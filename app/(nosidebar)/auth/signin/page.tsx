import { Metadata } from 'next'
import { auth } from '@/auth'
import { getProviders } from 'next-auth/react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FC } from 'react'

import { Posts } from '@/lib/components/Posts/Posts'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { Timeline } from '@/lib/services/timelines/types'
import { Provider } from '@/lib/types/nextauth'
import { cleanJson } from '@/lib/utils/cleanJson'

import { CredentialForm } from './CredentialForm'
import { SigninButton } from './SigninButton'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Sign in'
}

const Page: FC = async () => {
  const { host } = getConfig()
  const database = getDatabase()
  const [providers, session] = await Promise.all([
    getProviders(),
    auth()
  ])

  if (!database) throw new Error('Database is not available')
  if (session && session.user) {
    return redirect('/')
  }

  const statuses = await database.getTimeline({
    timeline: Timeline.LOCAL_PUBLIC
  })

  return (
    <div className="col-12">
      <div className="mb-4">
        <h1 className="mb-4">Sign-in</h1>
        {Object.values(providers ?? []).map((provider) => {
          const typedProvider = provider as Provider
          if (typedProvider.id === 'credentials') {
            return <CredentialForm key={typedProvider.id} provider={typedProvider} />
          }

          return <SigninButton key={typedProvider.id} provider={typedProvider} />
        })}
        <Link href="/auth/signup">Signup</Link>
      </div>

      {statuses && statuses.length > 0 && (
        <div>
          <h2 className="mb-4">Local public timeline</h2>
          <Posts
            host={host}
            className="mt-4"
            currentTime={new Date()}
            statuses={statuses?.map((status) => cleanJson(status))}
          />
        </div>
      )}
    </div>
  )
}

export default Page
