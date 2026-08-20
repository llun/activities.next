import type { RegionBounds } from '@/lib/fitness/regions'
import {
  isPointInAnyBounds,
  splitSegmentByBounds
} from '@/lib/services/fitness-files/routeHeatmap'

import { TILE_EXTENT } from './constants'
import { TileSegment, tileLocalToLngLat } from './tileCodec'

/**
 * How a stored tile relates to the region a request is scoped to.
 *
 * - `inside` — every point the tile can hold is within the region, so the
 *   stored payload is forwarded untouched.
 * - `outside` — no point it can hold is, so it is answered as an empty tile
 *   and never read from the database at all.
 * - `partial` — it straddles a boundary and its geometry must be clipped.
 */
export type TileRegionOverlap = 'inside' | 'outside' | 'partial'

/**
 * The degrees box a tile covers.
 *
 * Derived from the tile-local extent rather than from the projection directly,
 * so it is the exact inverse of what the build quantized into: a point stored
 * at `v = 0` sits on the northern edge this returns, and one at `v =
 * TILE_EXTENT` on the southern. North is the SMALLER `v`, which is why the
 * latitudes come back crossed over.
 */
export const tileBounds = (z: number, x: number, y: number): RegionBounds => {
  const northWest = tileLocalToLngLat(z, x, y, 0, 0)
  const southEast = tileLocalToLngLat(z, x, y, TILE_EXTENT, TILE_EXTENT)

  return {
    minLat: southEast.lat,
    maxLat: northWest.lat,
    minLng: northWest.lng,
    maxLng: southEast.lng
  }
}

const intersects = (a: RegionBounds, b: RegionBounds) =>
  a.minLat <= b.maxLat &&
  a.maxLat >= b.minLat &&
  a.minLng <= b.maxLng &&
  a.maxLng >= b.minLng

const contains = (outer: RegionBounds, inner: RegionBounds) =>
  outer.minLat <= inner.minLat &&
  outer.maxLat >= inner.maxLat &&
  outer.minLng <= inner.minLng &&
  outer.maxLng >= inner.maxLng

/**
 * Decides what a request scoped to `bounds` may see of one tile.
 *
 * An empty `bounds` means world scope — `getRegionBounds` answers that for a
 * region containing a `world` entry as well as for no region at all — and every
 * tile is then `inside`. This is the ONLY way a caller reaches unclipped
 * geometry, which is what keeps a rect-scoped share from serving the world
 * pyramid it was built from.
 *
 * A union of rects that together cover a tile no single rect covers is reported
 * `partial`. Clipping it point-by-point yields the same geometry `inside` would
 * have forwarded, just more slowly — the classification is allowed to be
 * pessimistic, never optimistic.
 *
 * An inverted or antimeridian-wrapping rect (`minLng > maxLng`) intersects
 * nothing here, exactly as it matches no point in `isPointInAnyBounds`. Such a
 * scope answers empty tiles rather than wrapping, which is the safe direction:
 * the failure serves less than asked for, never more.
 */
export const classifyTileAgainstRegion = (
  z: number,
  x: number,
  y: number,
  bounds: RegionBounds[]
): TileRegionOverlap => {
  if (bounds.length === 0) return 'inside'

  const tile = tileBounds(z, x, y)
  if (bounds.some((region) => contains(region, tile))) return 'inside'
  if (!bounds.some((region) => intersects(region, tile))) return 'outside'
  return 'partial'
}

/**
 * Drops every vertex outside the region, splitting a run that leaves and
 * re-enters into separate segments.
 *
 * The test is per-VERTEX and reuses the untiled heatmap's own splitter, so the
 * result cannot contain a point the region does not, whatever the tile held.
 * A run left with a single point is discarded by that splitter: one vertex
 * draws no line, and keeping it would leak that something was there.
 *
 * Counts ride along unchanged. A clipped run was traced by exactly the
 * activities the whole run was; clipping removes geometry, not visits.
 */
export const clipTileSegmentsToRegion = (
  z: number,
  x: number,
  y: number,
  segments: TileSegment[],
  bounds: RegionBounds[]
): TileSegment[] => {
  if (bounds.length === 0) return segments

  return segments.flatMap((segment) => {
    const points: Array<{ lat: number; lng: number; u: number; v: number }> = []
    for (let index = 0; index < segment.points.length; index += 2) {
      const u = segment.points[index]
      const v = segment.points[index + 1]
      points.push({ ...tileLocalToLngLat(z, x, y, u, v), u, v })
    }

    // Fast path for the common straddling tile whose every point happens to be
    // inside: no reallocation, and identical output to the split below.
    if (points.every((point) => isPointInAnyBounds(point, bounds))) {
      return [segment]
    }

    return splitSegmentByBounds(
      { isHiddenByPrivacy: Boolean(segment.hidden), points },
      bounds
    ).map((run) => ({
      count: segment.count,
      ...(run.isHiddenByPrivacy ? { hidden: true as const } : {}),
      points: run.points.flatMap((point) => [point.u, point.v])
    }))
  })
}
