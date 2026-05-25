import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorProfile } from '@/lib/types/domain/actor'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { SearchPageClient } from './SearchPageClient'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Search'
}

const Page = async () => {
  const { host } = getConfig()
  const database = getDatabase()
  if (!database) {
    throw new Error('Failed to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor) {
    return redirect('/auth/signin')
  }

  const settings = await database.getActorSettings({ actorId: actor.id })

  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-muted-foreground">
          <p className="text-sm font-medium">Loading search...</p>
        </div>
      }
    >
      <SearchPageClient
        host={host}
        currentActor={getActorProfile(actor)}
        currentTime={Date.now()}
        postLineLimit={settings?.postLineLimit}
      />
    </Suspense>
  )
}

export default Page
