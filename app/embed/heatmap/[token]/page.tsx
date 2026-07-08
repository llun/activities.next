import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { FC } from 'react'

import { getPublicMapProvider } from '@/lib/config/mapProvider'
import { getDatabase } from '@/lib/database'
import { toPublicHeatmap } from '@/lib/services/fitness-files/publicHeatmap'

import { PublicHeatmapEmbed } from './PublicHeatmapEmbed'

export const dynamic = 'force-dynamic'

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
  // Only render a completed heatmap. A shared heatmap that is re-queued for
  // generation keeps its token but transitions back to pending/generating; 404
  // during that window rather than publish a partial/in-progress embed.
  if (!heatmap || heatmap.status !== 'completed') notFound()

  // Flatten the privacy distinction so the public embed shows no hole and no
  // highlight around private locations (see toPublicHeatmap).
  const publicHeatmap = toPublicHeatmap(heatmap)
  const mapProvider = getPublicMapProvider()

  // The owner-assigned region label (persisted per (actor, region) — see the
  // region-names store). Shown as a caption so the embed is self-labelled, e.g.
  // "Netherlands". The world-wide region is never named. The label is
  // non-critical chrome, so a lookup failure degrades to no caption rather than
  // failing the whole embed.
  let regionName: string | undefined
  try {
    const regionNames = await database.getFitnessRouteHeatmapRegionNames({
      actorId: heatmap.actorId
    })
    regionName = regionNames.find(
      (entry) => entry.region === heatmap.region
    )?.name
  } catch {
    regionName = undefined
  }

  // Only forward what the map actually renders. The raw generation `error`
  // string is omitted, and the internal generation counters (activityCount,
  // pointCount, totalCount, cursorOffset, isPartial — which reveal the actor's
  // file count and scan progress) are zeroed: as Client Component props they
  // would otherwise be serialized into the public RSC payload on this
  // unauthenticated surface.
  return (
    <PublicHeatmapEmbed
      heatmap={{
        id: publicHeatmap.id,
        activityType: publicHeatmap.activityType,
        periodType: publicHeatmap.periodType,
        periodKey: publicHeatmap.periodKey,
        region: publicHeatmap.region,
        status: publicHeatmap.status,
        bounds: publicHeatmap.bounds ?? null,
        segments: publicHeatmap.segments,
        activityCount: 0,
        pointCount: 0,
        totalCount: 0,
        cursorOffset: 0,
        isPartial: false,
        createdAt: publicHeatmap.createdAt,
        updatedAt: publicHeatmap.updatedAt
      }}
      mapProvider={mapProvider}
      regionName={regionName}
    />
  )
}

export default Page
