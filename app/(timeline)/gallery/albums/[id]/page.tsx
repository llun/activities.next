import { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getGalleryAlbumDetail } from '@/lib/services/gallery/galleryAlbumQueries'
import { getGalleryAlbumPublicUrl } from '@/lib/services/gallery/galleryAlbumUrls'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { GalleryAlbumDetailView } from './GalleryAlbumDetailView'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Gallery Albums'
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
  if (!actor || !actor.account) {
    return redirect('/auth/signin')
  }

  const { id } = await params
  // A missing album and somebody else's are the same 404.
  const detail = await getGalleryAlbumDetail({
    database,
    owner: actor,
    albumId: id,
    limit: PAGE_SIZE
  })
  if (!detail) {
    return notFound()
  }

  return (
    <GalleryAlbumDetailView
      ownerId={actor.id}
      shareUrl={getGalleryAlbumPublicUrl({ actor, albumId: detail.album.id })}
      detail={detail}
      pageSize={PAGE_SIZE}
    />
  )
}

export default Page
