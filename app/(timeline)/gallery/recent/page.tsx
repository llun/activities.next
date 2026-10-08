import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { OWNER_GALLERY_AUDIENCE } from '@/lib/services/gallery/galleryAudience'
import { getGalleryMediaPage } from '@/lib/services/gallery/galleryQueries'
import {
  MEDIA_SUBJECT_CATEGORIES,
  type MediaSubjectCategory
} from '@/lib/types/database/gallery'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { GalleryRecentView } from './GalleryRecentView'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Gallery Recent'
}

interface PageProps {
  searchParams: Promise<{ category?: string | string[] }>
}

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

  const { category: rawCategory } = await searchParams
  const candidate = Array.isArray(rawCategory) ? rawCategory[0] : rawCategory
  const category = MEDIA_SUBJECT_CATEGORIES.find((value) => value === candidate)

  const page = await getGalleryMediaPage({
    database,
    owner: actor,
    audience: OWNER_GALLERY_AUDIENCE,
    limit: 30,
    category
  })

  return (
    <GalleryRecentView
      // A different filter in the URL is a different page of results.
      key={category ?? 'all'}
      actorId={actor.id}
      initialCategory={(category ?? null) as MediaSubjectCategory | null}
      initialPage={page}
    />
  )
}

export default Page
