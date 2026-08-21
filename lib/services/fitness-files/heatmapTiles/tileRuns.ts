import type { LatLng } from '@/lib/fitness/regions'

import { TileSegment, tileLocalToLngLat } from './tileCodec'

/**
 * One drawable run from a tile, in degrees.
 *
 * A stored `TileSegment` is meaningless on its own: its points are integers in
 * the tile's own 0..TILE_EXTENT space, so the same numbers mean different
 * places in different tiles. Everything downstream of the decode therefore
 * carries degrees, and the `(z, x, y)` that produced them is consumed here and
 * never travels further.
 *
 * This lives in the service layer rather than beside the map components because
 * the static image renderer needs it too, and a server module must not import
 * a value out of `lib/components`.
 */
export interface HeatmapTileRun {
  /** How many distinct activities traced this run; drives colour and opacity. */
  count: number
  hidden: boolean
  points: LatLng[]
}

/**
 * Places a decoded tile's runs on the globe.
 *
 * Runs of fewer than two points are dropped, matching `buildRouteGeoJson`: one
 * vertex draws no line, and on a public surface its presence alone would say
 * something happened there.
 */
export const tileRunsToLngLat = (
  z: number,
  x: number,
  y: number,
  segments: TileSegment[]
): HeatmapTileRun[] =>
  segments.flatMap((segment) => {
    if (segment.points.length < 4) return []

    const points: LatLng[] = []
    for (let index = 0; index < segment.points.length; index += 2) {
      points.push(
        tileLocalToLngLat(
          z,
          x,
          y,
          segment.points[index],
          segment.points[index + 1]
        )
      )
    }
    return [{ count: segment.count, hidden: Boolean(segment.hidden), points }]
  })
