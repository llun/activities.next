import { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { OWNER_GALLERY_AUDIENCE } from '@/lib/services/gallery/galleryAudience'
import { toGalleryGearEntity } from '@/lib/services/gallery/galleryEntities'
import { getGalleryGearOverview } from '@/lib/services/gallery/galleryGearUsage'
import { getGalleryMediaPage } from '@/lib/services/gallery/galleryQueries'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { GalleryGearDetailView } from './GalleryGearDetailView'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Gallery Gear'
}

// The first page of the grid; "Load more" fetches the rest.
const PAGE_SIZE = 30

interface PageProps {
  params: Promise<{ id: string }>
}

const Page = async ({ params }: PageProps) => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor) {
    return redirect('/auth/signin')
  }

  const { id } = await params
  // Ownership check happens here so a stranger's gear id 404s instead of
  // rendering a shell that then fails to find the row client-side.
  const gear = await database.getGalleryGear({ id, actorId: actor.id })
  if (!gear) {
    return notFound()
  }

  const [overview, page] = await Promise.all([
    getGalleryGearOverview({ database, actorId: actor.id, gearId: gear.id }),
    getGalleryMediaPage({
      database,
      owner: { id: actor.id },
      audience: OWNER_GALLERY_AUDIENCE,
      limit: PAGE_SIZE,
      gearId: gear.id
    })
  ])

  return (
    <GalleryGearDetailView
      ownerId={actor.id}
      gear={{ ...toGalleryGearEntity(gear), ...overview.usage }}
      mostUsedWith={overview.mostUsedWith}
      initialPage={page}
    />
  )
}

export default Page
