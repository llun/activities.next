import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { FC } from 'react'

import { getBaseURL, getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { toPublicHeatmap } from '@/lib/services/fitness-files/publicHeatmap'
import { getPublicMapboxAccessToken } from '@/lib/utils/mapbox'

import { SharedHeatmapPage } from './SharedHeatmapPage'
import { buildSharedHeatmapView } from './sharedHeatmapView'

export const dynamic = 'force-dynamic'

// A capability URL (the token is the secret), so keep it out of search indexes.
export const metadata: Metadata = {
  title: 'Route heatmap',
  robots: { index: false, follow: false }
}

interface PageProps {
  params: Promise<{ token: string }>
}

const Page: FC<PageProps> = async ({ params }) => {
  const { token } = await params

  const database = getDatabase()
  if (!database) notFound()

  const heatmap = await database.getFitnessRouteHeatmapByShareToken({
    shareToken: token
  })
  // Only render a completed heatmap. A shared heatmap re-queued for generation
  // keeps its token but transitions back to pending/generating; 404 during that
  // window rather than publish a partial/in-progress page.
  if (!heatmap || heatmap.status !== 'completed') notFound()

  // Flatten the privacy distinction so the public page shows no hole and no
  // highlight around private locations (see toPublicHeatmap).
  const publicHeatmap = toPublicHeatmap(heatmap)

  // Owner display fields (name/handle/initials). Non-critical chrome, so a
  // lookup failure degrades to an actor-id-derived handle rather than 404ing.
  const owner = await database
    .getActorFromId({ id: heatmap.actorId })
    .catch(() => null)

  // The owner-assigned region label (e.g. "Netherlands"), shown as the title for
  // drawn areas. Best-effort: a lookup failure degrades to the generic label.
  let regionName: string | undefined
  try {
    const regionNames = await database.getFitnessRouteHeatmapRegionNames({
      actorId: heatmap.actorId
    })
    regionName = regionNames?.find(
      (entry) => entry.region === heatmap.region
    )?.name
  } catch {
    regionName = undefined
  }

  // Build the public URL against the actor's own canonical domain (matches the
  // in-app share snippet), falling back to the instance base URL.
  let origin: string
  try {
    origin = new URL(heatmap.actorId).origin
  } catch {
    origin = getBaseURL()
  }

  const view = buildSharedHeatmapView({
    heatmap: publicHeatmap,
    owner: owner
      ? { name: owner.name, username: owner.username, domain: owner.domain }
      : null,
    regionName,
    origin,
    token
  })

  const config = getConfig()
  const mapboxAccessToken = getPublicMapboxAccessToken(
    config.fitnessStorage?.mapboxAccessToken
  )

  return (
    <SharedHeatmapPage
      view={view}
      mapboxAccessToken={mapboxAccessToken}
      signupOpen={config.registrationOpen}
      signinUrl="/auth/signin"
      signupUrl="/auth/signup"
    />
  )
}

export default Page
