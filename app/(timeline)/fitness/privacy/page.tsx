import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { PageHeader } from '@/lib/components/page-header'
import { FitnessPrivacyLocationSettings } from '@/lib/components/settings/FitnessPrivacyLocationSettings'
import { getPublicMapProvider } from '@/lib/config/mapProvider'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Fitness Privacy'
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

  const mapProvider = getPublicMapProvider()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Privacy"
        description="Manage hidden locations for imported fitness routes."
      />
      <FitnessPrivacyLocationSettings mapProvider={mapProvider} />
    </div>
  )
}

export default Page
