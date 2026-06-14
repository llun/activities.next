import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { ExplorePageClient } from './ExplorePageClient'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Explore'
}

const Page = async () => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Failed to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor) {
    return redirect('/auth/signin')
  }

  // `currentTime` is passed from the server (a number, not a Date) so the
  // trending-post rows render identical relative timestamps on the server and
  // the client and never trip a hydration mismatch.
  return <ExplorePageClient currentTime={Date.now()} />
}

export default Page
