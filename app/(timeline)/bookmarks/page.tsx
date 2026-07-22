import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getBookmarkedStatusesPage } from '@/lib/services/bookmarks/getBookmarkedStatusesPage'
import { getActorProfile } from '@/lib/types/domain/actor'
import { cleanJson } from '@/lib/utils/cleanJson'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { BookmarksTimeline } from './BookmarksTimeline'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Bookmarks'
}

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
  const { statuses, nextMaxBookmarkId } = await getBookmarkedStatusesPage({
    database,
    actorId: actor.id,
    currentActor: actor,
    limit: 20
  })

  return (
    <BookmarksTimeline
      host={host}
      statuses={statuses.map((item) => cleanJson(item))}
      initialNextMaxBookmarkId={nextMaxBookmarkId}
      currentTime={Date.now()}
      currentActor={getActorProfile(actor)}
      isMediaUploadEnabled={Boolean(mediaStorage)}
      postLineLimit={settings?.postLineLimit}
    />
  )
}

export default Page
