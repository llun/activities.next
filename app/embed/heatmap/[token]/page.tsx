import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { FC } from 'react'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { toPublicHeatmap } from '@/lib/services/fitness-files/publicHeatmap'
import { getPublicMapboxAccessToken } from '@/lib/utils/mapbox'

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
  if (!heatmap) notFound()

  // Flatten the privacy distinction so the public embed shows no hole and no
  // highlight around private locations (see toPublicHeatmap).
  const publicHeatmap = toPublicHeatmap(heatmap)
  const mapboxAccessToken = getPublicMapboxAccessToken(
    getConfig().fitnessStorage?.mapboxAccessToken
  )

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
        activityCount: publicHeatmap.activityCount,
        pointCount: publicHeatmap.pointCount,
        totalCount: publicHeatmap.totalCount,
        cursorOffset: publicHeatmap.cursorOffset,
        isPartial: publicHeatmap.isPartial,
        error: publicHeatmap.error ?? null,
        createdAt: publicHeatmap.createdAt,
        updatedAt: publicHeatmap.updatedAt
      }}
      mapboxAccessToken={mapboxAccessToken}
    />
  )
}

export default Page
