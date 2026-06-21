import { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { getPublicMapboxAccessToken } from '@/lib/utils/mapbox'

import { FitnessHeatmapView } from './FitnessHeatmapView'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Fitness Heatmap'
}

const Page: FC = async () => {
  const database = getDatabase()
  if (!database) throw new Error('Database is not available')

  const session = await getServerAuthSession()
  const currentActor = await getActorFromSession(database, session)
  if (!currentActor) {
    return redirect('/auth/signin')
  }

  // Reserve notFound for unavailable data — there is no heatmap without activity.
  const hasFitnessData = await database.getActorHasFitnessData({
    actorId: currentActor.id
  })
  if (!hasFitnessData) {
    return notFound()
  }

  const mapboxAccessToken = getPublicMapboxAccessToken(
    getConfig().fitnessStorage?.mapboxAccessToken
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Heatmaps"
        description="Route density maps aggregated from your activities"
      />

      <FitnessHeatmapView
        actorId={currentActor.id}
        mapboxAccessToken={mapboxAccessToken}
      />
    </div>
  )
}

export default Page
