import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { OWNER_GALLERY_AUDIENCE } from '@/lib/services/gallery/galleryAudience'
import { getGalleryMediaPage } from '@/lib/services/gallery/galleryQueries'
import {
  GALLERY_SHOWS,
  type GalleryShow,
  MEDIA_SUBJECT_CATEGORIES,
  type MediaSubjectCategory
} from '@/lib/types/database/gallery'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { GalleryAllMediaView } from './GalleryAllMediaView'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Gallery All media'
}

interface PageProps {
  searchParams: Promise<{
    category?: string | string[]
    show?: string | string[]
  }>
}

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value

const Page = async ({ searchParams }: PageProps) => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor || !actor.account) {
    return redirect('/auth/signin')
  }

  const { category: rawCategory, show: rawShow } = await searchParams
  const categoryCandidate = first(rawCategory)
  const category = MEDIA_SUBJECT_CATEGORIES.find(
    (value) => value === categoryCandidate
  )
  const showCandidate = first(rawShow)
  // Everything unless the URL names one of the other lists.
  const show: GalleryShow =
    GALLERY_SHOWS.find((value) => value === showCandidate) ?? 'all'

  const page = await getGalleryMediaPage({
    database,
    owner: actor,
    audience: OWNER_GALLERY_AUDIENCE,
    limit: 30,
    category,
    show
  })

  return (
    <GalleryAllMediaView
      // A different filter in the URL is a different page of results.
      key={`${category ?? 'all'}:${show}`}
      actorId={actor.id}
      initialCategory={(category ?? null) as MediaSubjectCategory | null}
      initialShow={show}
      initialPage={page}
    />
  )
}

export default Page
