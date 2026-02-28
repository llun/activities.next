import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { FitnessPrivacyLocationSettings } from '@/lib/components/settings/FitnessPrivacyLocationSettings'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
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

  const session = await getServerSession(getAuthOptions())
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
