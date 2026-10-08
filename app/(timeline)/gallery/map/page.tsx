import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getPublicMapProvider } from '@/lib/config/mapProvider'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { OWNER_GALLERY_AUDIENCE } from '@/lib/services/gallery/galleryAudience'
import { getGalleryMapPoints } from '@/lib/services/gallery/galleryQueries'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { GalleryMapView } from './GalleryMapView'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Gallery Map'
}

const Page = async () => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor || !actor.account) {
    return redirect('/auth/signin')
  }

  const [map, settings] = await Promise.all([
    getGalleryMapPoints({
      database,
      owner: actor,
      audience: OWNER_GALLERY_AUDIENCE
    }),
    database.getGallerySettings({ actorId: actor.id })
  ])

  return (
    <GalleryMapView
      actorId={actor.id}
      username={actor.username}
      domain={actor.domain}
      initialPoints={map.points}
      initialTruncated={map.truncated}
      mapPublic={settings.mapPublic}
      mapProvider={getPublicMapProvider()}
    />
  )
}

export default Page
