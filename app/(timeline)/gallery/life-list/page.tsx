import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { FC } from 'react'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { OWNER_GALLERY_AUDIENCE } from '@/lib/services/gallery/galleryAudience'
import { getGalleryLifeList } from '@/lib/services/gallery/galleryQueries'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { GalleryLifeListView } from './GalleryLifeListView'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Gallery Life List'
}

const Page: FC = async () => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor || !actor.account) {
    return redirect('/auth/signin')
  }

  const data = await getGalleryLifeList({
    database,
    owner: actor,
    audience: OWNER_GALLERY_AUDIENCE
  })

  return <GalleryLifeListView data={data} />
}

export default Page
