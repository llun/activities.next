import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getFavouritedStatusesPage } from '@/lib/services/favourites/getFavouritedStatusesPage'
import { getActorProfile } from '@/lib/types/domain/actor'
import { cleanJson } from '@/lib/utils/cleanJson'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { FavoritesTimeline } from './FavoritesTimeline'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Favorites'
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
  const { statuses, nextMaxFavouriteId } = await getFavouritedStatusesPage({
    database,
    actorId: actor.id,
    currentActor: actor,
    limit: 20
  })

  return (
    <FavoritesTimeline
      host={host}
      statuses={statuses.map((item) => cleanJson(item))}
      initialNextMaxFavouriteId={nextMaxFavouriteId}
      currentTime={Date.now()}
      currentActor={getActorProfile(actor)}
      isMediaUploadEnabled={Boolean(mediaStorage)}
      postLineLimit={settings?.postLineLimit}
    />
  )
}

export default Page
