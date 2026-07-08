import type {
  FitnessRouteHeatmapBounds,
  FitnessRouteHeatmapSegment
} from '@/lib/client'
import type { LatLng } from '@/lib/fitness/regions'

// Absolute grid-cell size (degrees) used to cluster route points for the initial
// view. ~5° ≈ a few hundred km, so activities within a metro area land in the
// same or an 8-connected neighbouring cell while far-apart regions (e.g. Europe
// vs Singapore) fall into disjoint, non-adjacent cells. See computeFocusBounds.
const FOCUS_CLUSTER_CELL_DEG = 5

export const buildRouteGeoJson = (segments: FitnessRouteHeatmapSegment[]) => ({
  type: 'FeatureCollection' as const,
  features: segments
    .filter((segment) => segment.points.length >= 2)
    .map((segment) => ({
      type: 'Feature' as const,
      properties: {
        isHiddenByPrivacy: Boolean(segment.isHiddenByPrivacy)
      },
      geometry: {
        type: 'LineString' as const,
        coordinates: segment.points.map((point) => [point.lng, point.lat])
      }
    }))
})

// Thin route geometry toward `maxPoints` vertices so the GL line layer stays
// performant on large caches (a whole-world cache can aggregate far more). The
// stride is derived from the global vertex total, so it bounds the dominant cost
// — long routes — proportionally; each segment still keeps its first and last
// vertex, so routes span their full extent. This is a best-effort target, not a
// hard ceiling: the per-segment endpoint floor (~2 vertices per segment) keeps a
// realistic many-route cache well under budget, but pathological inputs (tens of
// thousands of tiny segments) could still exceed it.
export const downsampleSegments = (
  segments: FitnessRouteHeatmapSegment[],
  maxPoints: number
): FitnessRouteHeatmapSegment[] => {
  const totalPoints = segments.reduce(
    (sum, segment) => sum + segment.points.length,
    0
  )
  if (totalPoints <= maxPoints) {
    return segments
  }

  const stride = Math.ceil(totalPoints / maxPoints)
  return segments.map((segment) => {
    if (segment.points.length <= 2) {
      return segment
    }

    const points = segment.points.filter((_, index) => index % stride === 0)
    const lastPoint = segment.points[segment.points.length - 1]
    if (points[points.length - 1] !== lastPoint) {
      points.push(lastPoint)
    }
    return { ...segment, points }
  })
}

export interface RouteFocusBounds {
  bounds: FitnessRouteHeatmapBounds
  /** True when the view was tightened to a single dense cluster (disjoint data). */
  focused: boolean
}

const cellKey = (cellX: number, cellY: number) => `${cellX}:${cellY}`

// A grid cell's point count plus the bounding box of the (finite) vertices in it,
// accumulated in a single pass so the focused extent needs no second scan.
interface FocusCell {
  count: number
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

// Pick the initial map view for a route cache. A whole-world / multi-region cache
// has bounds spanning every recorded region (e.g. Europe *and* Singapore), so
// fitting the full extent renders the routes as a tiny scatter on a flat world
// map. Instead, bucket the route vertices into an absolute lon/lat grid, flood
// fill the 8-connected cluster containing the densest cell, and fit to that
// cluster — so the map opens zoomed in on where most activity is while the user
// can still pan to the other regions. For a single contiguous region every
// vertex falls in one connected cluster, so the authoritative full bounds are
// returned unchanged (focused: false).
//
// Note: clusters straddling the antimeridian (±180° lon) land in non-adjacent
// cells and would not be merged; that is acceptable for this best-effort initial
// framing (mercator fitBounds has its own antimeridian limitations regardless).
export const computeFocusBounds = (
  segments: FitnessRouteHeatmapSegment[],
  bounds: FitnessRouteHeatmapBounds
): RouteFocusBounds => {
  // Single pass: bucket every finite vertex into an absolute grid cell, tracking
  // each cell's point count and bounding box. Non-finite vertices are skipped so
  // they never create a spurious cell.
  const cells = new Map<string, FocusCell>()
  for (const segment of segments) {
    for (const point of segment.points) {
      if (!Number.isFinite(point.lng) || !Number.isFinite(point.lat)) continue
      const key = cellKey(
        Math.floor(point.lng / FOCUS_CLUSTER_CELL_DEG),
        Math.floor(point.lat / FOCUS_CLUSTER_CELL_DEG)
      )
      const cell = cells.get(key)
      if (!cell) {
        cells.set(key, {
          count: 1,
          minLat: point.lat,
          maxLat: point.lat,
          minLng: point.lng,
          maxLng: point.lng
        })
        continue
      }
      cell.count += 1
      if (point.lat < cell.minLat) cell.minLat = point.lat
      if (point.lat > cell.maxLat) cell.maxLat = point.lat
      if (point.lng < cell.minLng) cell.minLng = point.lng
      if (point.lng > cell.maxLng) cell.maxLng = point.lng
    }
  }

  // 0 or 1 occupied cell: nothing to disambiguate — show the full bounds.
  if (cells.size <= 1) {
    return { bounds, focused: false }
  }

  let seedKey = ''
  let seedCount = -1
  for (const [key, cell] of cells) {
    if (cell.count > seedCount) {
      seedCount = cell.count
      seedKey = key
    }
  }

  // 8-connected flood fill over occupied cells starting from the densest one.
  // Cells are marked visited as they are enqueued, so each is pushed exactly
  // once and only occupied neighbours enter the stack.
  const cluster = new Set<string>([seedKey])
  const stack = [seedKey]
  while (stack.length > 0) {
    const key = stack.pop() as string
    const [cellX, cellY] = key.split(':').map(Number)
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        if (dx === 0 && dy === 0) continue
        const neighborKey = cellKey(cellX + dx, cellY + dy)
        if (cells.has(neighborKey) && !cluster.has(neighborKey)) {
          cluster.add(neighborKey)
          stack.push(neighborKey)
        }
      }
    }
  }

  // Every occupied cell is in one connected cluster → the data is contiguous, so
  // the full bounds already frame it well.
  if (cluster.size === cells.size) {
    return { bounds, focused: false }
  }

  // Union the densest cluster's per-cell boxes into the focused extent. Each cell
  // came from at least one finite vertex, so the result is always finite.
  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  for (const key of cluster) {
    const cell = cells.get(key) as FocusCell
    if (cell.minLat < minLat) minLat = cell.minLat
    if (cell.maxLat > maxLat) maxLat = cell.maxLat
    if (cell.minLng < minLng) minLng = cell.minLng
    if (cell.maxLng > maxLng) maxLng = cell.maxLng
  }

  return { bounds: { minLat, maxLat, minLng, maxLng }, focused: true }
}

export type Box = { nw: LatLng; se: LatLng }

export const round2 = (value: number): number => Number(value.toFixed(2))

// Normalize any two points to nw (top-left) / se (bottom-right), rounded to the
// same 2-dp precision the coordinate fields and serialization use.
export const boxFromPoints = (a: LatLng, b: LatLng): Box => ({
  nw: {
    lat: round2(Math.max(a.lat, b.lat)),
    lng: round2(Math.min(a.lng, b.lng))
  },
  se: {
    lat: round2(Math.min(a.lat, b.lat)),
    lng: round2(Math.max(a.lng, b.lng))
  }
})

export const boxToPolygon = (box: Box) => ({
  type: 'Feature' as const,
  properties: {},
  geometry: {
    type: 'Polygon' as const,
    coordinates: [
      [
        [box.nw.lng, box.nw.lat],
        [box.se.lng, box.nw.lat],
        [box.se.lng, box.se.lat],
        [box.nw.lng, box.se.lat],
        [box.nw.lng, box.nw.lat]
      ]
    ]
  }
})
