import { ArrowLeft } from 'lucide-react'
import { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { Button } from '@/lib/components/ui/button'
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
        actions={
          <Button variant="ghost" size="icon" asChild>
            <Link href="/fitness">
              <ArrowLeft className="h-5 w-5" />
              <span className="sr-only">Back to overview</span>
            </Link>
          </Button>
        }
      />

      <FitnessHeatmapView
        actorId={currentActor.id}
        mapboxAccessToken={mapboxAccessToken}
      />
    </div>
  )
}

export default Page
