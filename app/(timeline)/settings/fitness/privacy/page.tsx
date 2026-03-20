import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { FitnessPrivacyLocationSettings } from '@/lib/components/settings/FitnessPrivacyLocationSettings'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Fitness Privacy Settings'
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

  const mapboxAccessToken =
    getConfig().fitnessStorage?.mapboxAccessToken?.trim()

  return (
    <div className="space-y-6">
      <FitnessPrivacyLocationSettings mapboxAccessToken={mapboxAccessToken} />
    </div>
  )
}

export default Page
