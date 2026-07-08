import { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { getBaseURL } from '@/lib/config'
import { getPublicMapProvider } from '@/lib/config/mapProvider'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

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

  const mapProvider = getPublicMapProvider()

  // Compute the embed origin on the server (the actor's own canonical domain,
  // falling back to the instance base URL) so the share snippets are identical
  // in SSR and on the client — no `window`, no hydration mismatch.
  let embedOrigin: string
  try {
    embedOrigin = new URL(currentActor.id).origin
  } catch {
    embedOrigin = getBaseURL()
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Heatmaps"
        description="Route density maps aggregated from your activities — one per region"
      />

      <FitnessHeatmapView
        actorId={currentActor.id}
        mapProvider={mapProvider}
        embedOrigin={embedOrigin}
      />
    </div>
  )
}

export default Page
