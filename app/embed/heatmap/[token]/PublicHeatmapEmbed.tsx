'use client'

import { FC } from 'react'

import { FitnessRouteHeatmapData } from '@/lib/client'
import { RouteHeatmapMap } from '@/lib/components/fitness/RouteHeatmapMap'

interface PublicHeatmapEmbedProps {
  heatmap: FitnessRouteHeatmapData
  mapboxAccessToken?: string
  /** Owner-assigned region label, shown as a caption (e.g. "Netherlands"). */
  regionName?: string
}

// Full-bleed interactive map for the iframe embed. Privacy segments are already
// flattened server-side (see toPublicHeatmap), so RouteHeatmapMap renders every
// route uniformly here.
export const PublicHeatmapEmbed: FC<PublicHeatmapEmbedProps> = ({
  heatmap,
  mapboxAccessToken,
  regionName
}) => {
  const caption = regionName?.trim()

  return (
    <div className="relative h-dvh w-full">
      <RouteHeatmapMap
        heatmap={heatmap}
        mapboxAccessToken={mapboxAccessToken}
        heightClassName="h-dvh"
      />
      {caption && (
        <div className="pointer-events-none absolute left-3 top-3 max-w-[80%] truncate rounded-md bg-background/90 px-2.5 py-1 text-sm font-medium text-foreground shadow-sm">
          {caption}
        </div>
      )}
    </div>
  )
}
