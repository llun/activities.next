import {
  HeatmapTileRun,
  tileRunsToLngLat
} from '@/lib/services/fitness-files/heatmapTiles/tileRuns'

export type { HeatmapTileRun }
export { tileRunsToLngLat }

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
