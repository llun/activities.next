import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { PageHeader } from '@/lib/components/page-header'
import { FitnessTrainingZonesSettings } from '@/lib/components/settings/FitnessTrainingZonesSettings'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getTrainingZoneSettings } from '@/lib/services/fitness-files/trainingZoneSettings'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Fitness Zones'
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

  const initialZones = await getTrainingZoneSettings(database, actor.id)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Zones"
        description="Set your heart-rate and power zones from your own numbers."
      />
      <FitnessTrainingZonesSettings initialZones={initialZones} />
    </div>
  )
}

export default Page
