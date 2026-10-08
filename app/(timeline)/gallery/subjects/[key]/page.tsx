import { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { OWNER_GALLERY_AUDIENCE } from '@/lib/services/gallery/galleryAudience'
import {
  getGalleryMediaPage,
  getGallerySubjects
} from '@/lib/services/gallery/galleryQueries'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { GallerySubjectDetailView } from './GallerySubjectDetailView'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Gallery Subject'
}

interface PageProps {
  params: Promise<{ key: string }>
}

// A malformed escape in the path would otherwise throw a 500.
const decodeKey = (key: string): string | null => {
  try {
    return decodeURIComponent(key)
  } catch {
    return null
  }
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

  const { key: rawKey } = await params
  const subjectKey = decodeKey(rawKey)
  if (!subjectKey) return notFound()

  const [page, subjects] = await Promise.all([
    getGalleryMediaPage({
      database,
      owner: actor,
      audience: OWNER_GALLERY_AUDIENCE,
      limit: 30,
      subjectKey
    }),
    getGallerySubjects({
      database,
      owner: actor,
      audience: OWNER_GALLERY_AUDIENCE
    })
  ])

  const entry = subjects.groups
    .flatMap((group) => group.subjects)
    .find((subject) => subject.key === subjectKey)

  if (entry) {
    const { cover: _cover, ...subject } = entry
    return (
      <GallerySubjectDetailView
        actorId={actor.id}
        subject={subject}
        initialPage={page}
      />
    )
  }

  // The index is capped, so a subject seen only on older photos has no entry
  // while its photos are still reachable. 404 only when nothing is there.
  const first = page.items[0]
  if (!first && page.nextMaxId === null) return notFound()

  return (
    <GallerySubjectDetailView
      actorId={actor.id}
      subject={{
        key: subjectKey,
        name: first?.subject?.name ?? null,
        scientificName: first?.subject?.scientificName ?? null,
        category: first?.subject?.category ?? null,
        count: null,
        firstSeenAt: null,
        lastSeenAt: null
      }}
      initialPage={page}
    />
  )
}

export default Page
