import {
  TILE_EXTENT,
  TILE_LADDER_ZOOMS,
  TILE_MAX_ZOOM,
  TILE_MIN_ZOOM
} from './constants'

/**
 * What a client needs to fetch tiles for a heatmap: the version its URLs must
 * carry, and the ladder it may ask for. Everything here is a build-time
 * constant except `version`, which is sent so the client can tell a rebuild
 * apart from a cache hit — it counts builds, not activities, so it says nothing
 * about the actor's data the way the generation counters do.
 *
 * Null means "this heatmap has no tiles"; the client draws the untiled geometry
 * that ships with it, which is the only thing every surface has always had.
 */
export interface HeatmapTileSource {
  version: number
  minZoom: number
  maxZoom: number
  ladder: number[]
  extent: number
}

/**
 * Whether a heatmap row is the one variant the pyramid describes.
 *
 * The pyramid is per-ACTOR and covers all activity types over all time; region
 * is applied when tiles are served, not when they are built. So a row filtered
 * to one sport or one year is not something the pyramid can answer, however
 * complete that pyramid is — mirroring `isPyramidVariant` in the generation
 * job, which is what decides whether a run builds tiles at all.
 */
export const isPyramidVariantHeatmap = ({
  activityType,
  periodType
}: {
  activityType?: string | null
  periodType: string
}): boolean => !activityType && periodType === 'all_time'

export const buildHeatmapTileSource = (
  heatmap: { activityType?: string | null; periodType: string },
  pyramid: { status: string; version: number } | null | undefined
): HeatmapTileSource | null => {
  if (!isPyramidVariantHeatmap(heatmap)) return null
  if (!pyramid || pyramid.status !== 'completed' || pyramid.version < 1) {
    return null
  }

  return {
    version: pyramid.version,
    minZoom: TILE_MIN_ZOOM,
    maxZoom: TILE_MAX_ZOOM,
    ladder: [...TILE_LADDER_ZOOMS],
    extent: TILE_EXTENT
  }
}
