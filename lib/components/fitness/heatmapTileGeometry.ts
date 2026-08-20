import type { LatLng } from '@/lib/fitness/regions'
import {
  TileSegment,
  tileLocalToLngLat
} from '@/lib/services/fitness-files/heatmapTiles/tileCodec'

/**
 * One drawable run from a tile, in degrees.
 *
 * A stored `TileSegment` is meaningless on its own: its points are integers in
 * the tile's own 0..TILE_EXTENT space, so the same numbers mean different
 * places in different tiles. Everything downstream of the decode therefore
 * carries degrees, and the `(z, x, y)` that produced them is consumed here and
 * never travels further.
 */
export interface HeatmapTileRun {
  /** Distinct activities that traced this run; drives colour and opacity. */
  count: number
  hidden: boolean
  points: LatLng[]
}

/**
 * Places a decoded tile's runs on the globe.
 *
 * Runs of fewer than two points are dropped, matching `buildRouteGeoJson`:
 * one vertex draws no line, and on the public path its presence alone would
 * say something happened there.
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

/**
 * The GeoJSON the GL line layer draws.
 *
 * A SIBLING of `buildRouteGeoJson` rather than a widening of it. The untiled
 * blob has no visit count and never will — it is one polyline per activity, not
 * per shared stretch of road — so giving its features a `count` would mean
 * inventing one, and the tiled paint keys on exactly that property. The two
 * collections are the same shape apart from it.
 */
export const buildTileGeoJson = (runs: HeatmapTileRun[]) => ({
  type: 'FeatureCollection' as const,
  features: runs.map((run) => ({
    type: 'Feature' as const,
    properties: {
      count: run.count,
      isHiddenByPrivacy: run.hidden
    },
    geometry: {
      type: 'LineString' as const,
      coordinates: run.points.map((point): [number, number] => [
        point.lng,
        point.lat
      ])
    }
  }))
})
