import type { Database } from '@/lib/database/types'
import type { RegionBounds } from '@/lib/fitness/regions'
import type {
  FitnessRouteHeatmapBounds,
  FitnessRouteHeatmapSegment
} from '@/lib/types/database/fitnessRouteHeatmap'
import { projectWebMercator } from '@/lib/utils/webMercator'

import { TILE_LADDER_ZOOMS, TILE_MAX_ZOOM, TILE_MIN_ZOOM } from './constants'
import { decodeTile, tilesForBounds } from './tileCodec'
import {
  classifyTileAgainstRegion,
  clipTileSegmentsToRegion
} from './tileRegion'
import { HeatmapTileRun, tileRunsToLngLat } from './tileRuns'

/**
 * A run with its visit count kept, so a renderer can shade by it.
 *
 * `FitnessRouteHeatmapSegment` has no count and never will — it describes one
 * activity's polyline, not a shared stretch of road — so the count rides
 * alongside rather than being forced into it.
 */
export interface HeatmapSegmentWithCount extends FitnessRouteHeatmapSegment {
  count: number
}

interface BuildParams {
  actorId: string
  bounds: FitnessRouteHeatmapBounds
  width: number
  height: number
  /** The share's own scope. Empty means world; see resolveSharedHeatmapRegionBounds. */
  regionBounds: RegionBounds[]
}

/**
 * The stored rung to render an image of `width` pixels at.
 *
 * The same round-UP rule the interactive client uses, for the same reason: a
 * rung is simplified to one pixel AT ITS OWN zoom, so drawing a coarser one
 * into a larger image magnifies the simplification. Derived from the image's
 * own width rather than a viewport, because that is what "one pixel" means
 * here.
 */
export const imageZoomForBounds = (
  bounds: FitnessRouteHeatmapBounds,
  width: number,
  height: number
): number => {
  if (!(width > 0) || !(height > 0)) return TILE_MIN_ZOOM

  // Both axes, and the SMALLER wins, because that is how the renderer scales:
  // `buildHeatmapSvg` fits the projected box with `min(innerWidth / spanX,
  // innerHeight / spanY)`, so a tall narrow scope in a wide image is limited by
  // its height. Taking longitude alone would ask for a finer rung than the
  // image can show and read tiles nobody sees.
  //
  // Measured in projected units rather than degrees: a degree of latitude is
  // not a fixed number of pixels in Mercator, and away from the equator the
  // difference is large.
  const topLeft = projectWebMercator(
    { lat: bounds.maxLat, lng: bounds.minLng },
    0
  )
  const bottomRight = projectWebMercator(
    { lat: bounds.minLat, lng: bounds.maxLng },
    0
  )
  const spanX = bottomRight.x - topLeft.x
  const spanY = bottomRight.y - topLeft.y
  if (!(spanX > 0) || !(spanY > 0)) return TILE_MIN_ZOOM

  const exact = Math.min(Math.log2(width / spanX), Math.log2(height / spanY))
  const wanted = Math.ceil(exact)
  if (wanted <= TILE_MIN_ZOOM) return TILE_MIN_ZOOM
  return (
    (TILE_LADDER_ZOOMS as readonly number[]).find((zoom) => zoom >= wanted) ??
    TILE_MAX_ZOOM
  )
}

/**
 * Builds the geometry for a static heatmap image out of the tile pyramid, or
 * null when the pyramid cannot answer for this actor.
 *
 * Null is the caller's signal to keep using the stored blob — an actor with no
 * completed build, or a build that has since moved on, still has an image to
 * serve. The downstream point budgets in `staticHeatmapImage` apply unchanged;
 * this only changes where the geometry comes from, and at what fidelity.
 *
 * Clipping to the share's region happens HERE rather than being assumed: the
 * pyramid is stored unclipped and covers the actor's whole history, so an image
 * built from it without clipping would publish everywhere they have been. That
 * is the same boundary the tile routes enforce, and it has to be enforced again
 * on every path that reads the pyramid.
 */
export const buildHeatmapSegmentsFromTiles = async (
  database: Database,
  { actorId, bounds, width, height, regionBounds }: BuildParams
): Promise<HeatmapSegmentWithCount[] | null> => {
  const pyramid = await database.getFitnessRouteHeatmapPyramid({ actorId })
  if (!pyramid || pyramid.status !== 'completed' || pyramid.version < 1) {
    return null
  }

  const z = imageZoomForBounds(bounds, width, height)
  const range = tilesForBounds(bounds, z)
  if (range.maxY < range.minY) return null

  // Two reads when the bounds wrap the antimeridian: `tilesForBounds` answers
  // `minX > maxX` for a wrap and the range read is a `whereBetween`, which
  // matches nothing in that state rather than wrapping around.
  const lastColumn = 2 ** z - 1
  const spans =
    range.minX <= range.maxX
      ? [{ minX: range.minX, maxX: range.maxX }]
      : [
          { minX: range.minX, maxX: lastColumn },
          { minX: 0, maxX: range.maxX }
        ]

  const rows = (
    await Promise.all(
      spans.map((span) =>
        database.getFitnessRouteHeatmapTilesInRange({
          actorId,
          z,
          minX: span.minX,
          maxX: span.maxX,
          minY: range.minY,
          maxY: range.maxY
        })
      )
    )
  ).flat()

  const segments: HeatmapSegmentWithCount[] = []
  for (const row of rows) {
    // Only the build's own version. A rebuild in flight leaves two versions in
    // the table at once, and drawing them together shows heat no build ever
    // produced — the same rule the tile routes apply.
    if (row.version !== pyramid.version) continue

    // The ROW's own coordinate, not the zoom the query asked for. They agree —
    // the read is scoped to `z` — but a tile's points are only meaningful
    // against the tile that stored them, and reading that from anywhere else is
    // how geometry silently relocates.
    const { z: rowZ, x, y } = row
    const overlap = classifyTileAgainstRegion(rowZ, x, y, regionBounds)
    if (overlap === 'outside') continue

    const decoded = decodeTile(row.segments)
    const runs: HeatmapTileRun[] = tileRunsToLngLat(
      rowZ,
      x,
      y,
      overlap === 'partial'
        ? clipTileSegmentsToRegion(rowZ, x, y, decoded, regionBounds)
        : decoded
    )

    for (const run of runs) {
      // The privacy class is dropped, never the geometry — the same flattening
      // `flattenPrivacySegmentsForPublic` applies, for the same reason: a hole
      // or a highlight around home would pinpoint it.
      segments.push({ count: run.count, points: run.points })
    }
  }

  return segments
}
