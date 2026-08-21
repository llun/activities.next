'use client'

import { FC, useMemo } from 'react'

import {
  FitnessRouteHeatmapData,
  FitnessRouteHeatmapTileRequest,
  getPublicHeatmapTiles
} from '@/lib/client'
import { RouteHeatmapMap } from '@/lib/components/fitness/RouteHeatmapMap'
import type { PublicMapProvider } from '@/lib/utils/mapProvider'

interface PublicRouteHeatmapMapProps {
  heatmap: FitnessRouteHeatmapData
  mapProvider: PublicMapProvider
  /**
   * The share token that addresses these tiles. Null or absent — the owner
   * previewing a map they have not shared yet — leaves the map on its untiled
   * geometry, because an unshared heatmap has no public tile URL to ask.
   */
  token: string | null | undefined
  heightClassName?: string
}

/**
 * The heatmap map for a surface reached by a SHARE TOKEN.
 *
 * It exists because `fetchTiles` is a function and both public surfaces are
 * rendered from Server Components, which cannot pass one across the boundary.
 * Binding the token to the fetcher has to happen on the client, so it happens
 * here, once, rather than in each surface.
 *
 * The public fetcher deliberately takes no region: the server clips to the
 * shared row's own scope, and honouring one sent from here would let a token
 * address more than it was cut to.
 */
export const PublicRouteHeatmapMap: FC<PublicRouteHeatmapMapProps> = ({
  heatmap,
  mapProvider,
  token,
  heightClassName
}) => {
  const fetchTiles = useMemo(
    () =>
      token
        ? (request: FitnessRouteHeatmapTileRequest) =>
            getPublicHeatmapTiles({ ...request, token })
        : undefined,
    [token]
  )

  return (
    <RouteHeatmapMap
      heatmap={heatmap}
      mapProvider={mapProvider}
      fetchTiles={fetchTiles}
      heightClassName={heightClassName}
    />
  )
}
