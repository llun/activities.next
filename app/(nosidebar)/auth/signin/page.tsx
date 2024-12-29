import { Metadata } from 'next'
import { getProviders } from 'next-auth/react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FC } from 'react'

import { auth } from '@/auth'
import { Posts } from '@/lib/components/Posts/Posts'
import { getConfig } from '@/lib/config'
import { Timeline } from '@/lib/services/timelines/types'
import { getStorage } from '@/lib/storage'

import { CredentialForm } from './CredentialForm'
import { ProviderList } from './ProviderList'
import { SigninButton } from './SigninButton'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Sign in'
}

const Page: FC = async () => {
  const { host } = getConfig()
  const [storage, session] = await Promise.all([getStorage(), auth()])

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
        <ProviderList />
        <Link href="/auth/signup">Signup</Link>
      </div>

      {statuses && statuses.length > 0 && (
        <div>
          <h2 className="mb-4">Local public timeline</h2>
          <Posts
            host={host}
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
