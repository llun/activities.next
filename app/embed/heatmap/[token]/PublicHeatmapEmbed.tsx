'use client'

import { FC } from 'react'

import { FitnessRouteHeatmapData } from '@/lib/client'
import { PublicRouteHeatmapMap } from '@/lib/components/fitness/PublicRouteHeatmapMap'
import type { PublicMapProvider } from '@/lib/utils/mapProvider'

interface PublicHeatmapEmbedProps {
  heatmap: FitnessRouteHeatmapData
  /** Which map backend renders the map. */
  mapProvider: PublicMapProvider
  /** Owner-assigned region label, shown as a caption (e.g. "Netherlands"). */
  regionName?: string
  /** The share token this embed was reached by; addresses its tiles. */
  token: string
}

// Full-bleed interactive map for the iframe embed. Privacy segments are already
// flattened server-side (see toPublicHeatmap), so RouteHeatmapMap renders every
// route uniformly here.
export const PublicHeatmapEmbed: FC<PublicHeatmapEmbedProps> = ({
  heatmap,
  mapProvider,
  regionName,
  token
}) => {
  const caption = regionName?.trim()

  return (
    <div className="relative h-dvh w-full">
      <PublicRouteHeatmapMap
        heatmap={heatmap}
        mapProvider={mapProvider}
        token={token}
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
