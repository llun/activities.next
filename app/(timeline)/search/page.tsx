import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'

import {
  PageHeaderSkeleton,
  Skeleton,
  UserRowSkeleton
} from '@/lib/components/ui/skeleton'
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

const SearchFallback = () => (
  <div className="space-y-6">
    <PageHeaderSkeleton />
    <div className="flex gap-2" aria-hidden="true">
      <Skeleton className="h-11 flex-1 rounded-md" />
      <Skeleton className="h-11 w-24 rounded-md" />
    </div>
    <div
      className="grid grid-cols-4 gap-1 rounded-lg bg-muted/60 p-1"
      aria-hidden="true"
    >
      <Skeleton className="h-8 rounded-md" />
      <Skeleton className="h-8 rounded-md" />
      <Skeleton className="h-8 rounded-md" />
      <Skeleton className="h-8 rounded-md" />
    </div>
    <div
      className="overflow-hidden rounded-2xl border bg-background/80 shadow-sm"
      aria-hidden="true"
    >
      <UserRowSkeleton />
      <UserRowSkeleton />
      <UserRowSkeleton />
    </div>
  </div>
)

const Page = async () => {
  const { host, mediaStorage } = getConfig()
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
    <Suspense fallback={<SearchFallback />}>
      <SearchPageClient
        host={host}
        currentActor={getActorProfile(actor)}
        currentTime={Date.now()}
        isMediaUploadEnabled={Boolean(mediaStorage)}
        postLineLimit={settings?.postLineLimit}
      />
    </Suspense>
  )
}

export default Page
