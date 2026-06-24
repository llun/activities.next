import type { RegionBounds } from '@/lib/fitness/regions'
import {
  PrivacySegment,
  downsamplePrivacySegments
} from '@/lib/services/fitness-files/privacy'
import {
  FitnessRouteHeatmapBounds,
  FitnessRouteHeatmapSegment
} from '@/lib/types/database/fitnessRouteHeatmap'
import {
  calculateCoordinateBounds,
  isFiniteBounds
} from '@/lib/utils/webMercator'

import type { FitnessCoordinate } from './parseFitnessFile'
import {
  MAX_BUDGET_PASSES,
  everySegmentAtMinimum,
  simplifyPoints,
  totalPointCount
} from './simplifyRoute'

export interface RouteHeatmapPoint extends FitnessCoordinate {
  isHiddenByPrivacy: boolean
}

export interface BuildRouteHeatmapPayloadParams {
  privacySegments: Array<PrivacySegment<RouteHeatmapPoint>>
  regionBounds?: RegionBounds[]
  maxPoints?: number
  /**
   * When positive, each segment is simplified with Ramer–Douglas–Peucker at this
   * meters tolerance before the `maxPoints` cap, so the stored geometry keeps its
   * road-following shape instead of being uniformly decimated. Left unset (0) for
   * intermediate checkpoint payloads, which must preserve raw points so a resumed
   * run keeps accumulating at full fidelity.
   */
  simplifyToleranceMeters?: number
}

export interface RouteHeatmapPayload {
  bounds: FitnessRouteHeatmapBounds | null
  segments: FitnessRouteHeatmapSegment[]
  pointCount: number
}

export const DEFAULT_ROUTE_HEATMAP_MAX_POINTS = 80_000

export const isPointInAnyBounds = (
  point: FitnessCoordinate,
  bounds: RegionBounds[]
): boolean =>
  bounds.some(
    (b) =>
      point.lat >= b.minLat &&
      point.lat <= b.maxLat &&
      point.lng >= b.minLng &&
      point.lng <= b.maxLng
  )

export const splitSegmentByBounds = <T extends FitnessCoordinate>(
  segment: PrivacySegment<T>,
  bounds: RegionBounds[]
): Array<PrivacySegment<T>> => {
  if (bounds.length === 0) {
    return [segment]
  }

  const segments: Array<PrivacySegment<T>> = []
  let current: T[] = []

  for (const point of segment.points) {
    if (isPointInAnyBounds(point, bounds)) {
      current.push(point)
      continue
    }

    if (current.length >= 2) {
      segments.push({
        isHiddenByPrivacy: segment.isHiddenByPrivacy,
        points: current
      })
    }
    current = []
  }

  if (current.length >= 2) {
    segments.push({
      isHiddenByPrivacy: segment.isHiddenByPrivacy,
      points: current
    })
  }

  return segments
}

const round6 = (value: number) => Math.round(value * 1_000_000) / 1_000_000

const normalizeCoordinate = (point: FitnessCoordinate) => ({
  lat: round6(point.lat),
  lng: round6(point.lng)
})

const toRouteSegment = (
  segment: PrivacySegment<RouteHeatmapPoint>
): FitnessRouteHeatmapSegment => ({
  ...(segment.isHiddenByPrivacy ? { isHiddenByPrivacy: true } : {}),
  points: segment.points.map(normalizeCoordinate)
})

export const buildRouteHeatmapPayload = ({
  privacySegments,
  regionBounds = [],
  maxPoints = DEFAULT_ROUTE_HEATMAP_MAX_POINTS,
  simplifyToleranceMeters = 0
}: BuildRouteHeatmapPayloadParams): RouteHeatmapPayload => {
  const filteredSegments = privacySegments
    .flatMap((segment) => splitSegmentByBounds(segment, regionBounds))
    .filter((segment) => segment.points.length >= 2)

  // Shape-preserving simplification first, so the `maxPoints` cap only has to
  // act as a ceiling for pathological caches rather than uniformly decimating
  // every route (which would cut corners off the road at street zoom). Start at
  // the finest tolerance and, only if the result still overflows the budget,
  // geometrically coarsen and re-simplify (still Douglas–Peucker, so a dense
  // region is coarsened rather than corner-cut). Reuse the original segment
  // object when simplifyPoints leaves the points untouched.
  const simplifyAt = (tolerance: number) =>
    filteredSegments
      .map((segment) => {
        const points = simplifyPoints(segment.points, tolerance)
        return points === segment.points ? segment : { ...segment, points }
      })
      .filter((segment) => segment.points.length >= 2)

  let simplifiedSegments = filteredSegments
  if (simplifyToleranceMeters > 0) {
    let tolerance = simplifyToleranceMeters
    simplifiedSegments = simplifyAt(tolerance)
    for (
      let pass = 0;
      pass < MAX_BUDGET_PASSES &&
      totalPointCount(simplifiedSegments) > maxPoints &&
      !everySegmentAtMinimum(simplifiedSegments);
      pass += 1
    ) {
      tolerance *= 2
      simplifiedSegments = simplifyAt(tolerance)
    }
  }

  const sampledSegments = downsamplePrivacySegments(
    simplifiedSegments,
    maxPoints,
    {
      minimumPointsPerSegment: 2
    }
  ).filter((segment) => segment.points.length >= 2)

  const routeSegments = sampledSegments.map(toRouteSegment)
  const points = routeSegments.flatMap((segment) => segment.points)
  const pointCount = points.length

  if (pointCount < 2) {
    return {
      bounds: null,
      segments: [],
      pointCount: 0
    }
  }

  const bounds = calculateCoordinateBounds(points)
  if (!isFiniteBounds(bounds)) {
    return {
      bounds: null,
      segments: [],
      pointCount: 0
    }
  }

  return {
    bounds,
    segments: routeSegments,
    pointCount
  }
}
