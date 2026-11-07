import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { PageHeader } from '@/lib/components/page-header'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getBlueskySharingState } from '@/lib/services/blueskySharing'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { BlueskySharingForm } from './BlueskySharingForm'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Other networks' }

const Page = async () => {
  const database = getDatabase()
  if (!database) throw new Error('Fail to load database')
  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor?.account) return redirect('/auth/signin')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bluesky"
        description="Share this profile’s public posts on Bluesky through Bridgy Fed."
      />
      <BlueskySharingForm
        key={actor.id}
        initialState={await getBlueskySharingState(database, actor)}
      />
    </div>
  )
}

export default Page
