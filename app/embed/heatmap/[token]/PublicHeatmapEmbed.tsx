'use client'

import { FC } from 'react'

import { FitnessRouteHeatmapData } from '@/lib/client'
import { RouteHeatmapMap } from '@/lib/components/fitness/RouteHeatmapMap'

interface PublicHeatmapEmbedProps {
  heatmap: FitnessRouteHeatmapData
  mapboxAccessToken?: string
}

// Full-bleed interactive map for the iframe embed. Privacy segments are already
// flattened server-side (see toPublicHeatmap), so RouteHeatmapMap renders every
// route uniformly here.
export const PublicHeatmapEmbed: FC<PublicHeatmapEmbedProps> = ({
  heatmap,
  mapboxAccessToken
}) => (
  <div className="h-dvh w-full">
    <RouteHeatmapMap
      heatmap={heatmap}
      mapboxAccessToken={mapboxAccessToken}
      heightClassName="h-dvh"
    />
  </div>
)
