import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { PageHeader } from '@/lib/components/page-header'
import { getPublicMapProvider } from '@/lib/config/mapProvider'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { GalleryPrivacySettings } from './GalleryPrivacySettings'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Gallery Privacy'
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Privacy"
        description="Where your media shows on the map, which details others see, and what goes in your gallery."
      />
      <GalleryPrivacySettings mapProvider={getPublicMapProvider()} />
    </div>
  )
}

export default Page
