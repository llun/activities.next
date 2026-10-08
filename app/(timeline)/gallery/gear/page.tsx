import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { GalleryGearListView } from './GalleryGearListView'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Gallery Gear'
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gear"
        description="Cameras and lenses, with every photo and video taken on them. New gear is read from your files and added for you to confirm."
      />
      <GalleryGearListView />
    </div>
  )
}

export default Page
