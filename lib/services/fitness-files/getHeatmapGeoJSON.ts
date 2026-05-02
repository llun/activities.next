import { RegionBounds, isPointInAnyBounds } from '@/lib/fitness/regions'
import { downsamplePrivacySegments } from '@/lib/services/fitness-files/privacy'
import type { PrivacySegment } from '@/lib/services/fitness-files/privacy'

import { FitnessCoordinate } from './parseFitnessFile'

export interface GeoJSONLineString {
  type: 'LineString'
  coordinates: [number, number][]
}

export interface GeoJSONFeature<G> {
  type: 'Feature'
  properties: Record<string, any>
  geometry: G
}

export interface GeoJSONFeatureCollection<G> {
  type: 'FeatureCollection'
  features: GeoJSONFeature<G>[]
}

export interface GetHeatmapGeoJSONParams {
  routeSegments: FitnessCoordinate[][]
  regionBounds?: RegionBounds[]
}

/**
 * Split a single route segment into multiple segments that lie within the given
 * region bounds.
 */
const splitRouteByBounds = (
  route: FitnessCoordinate[],
  bounds: RegionBounds[]
): FitnessCoordinate[][] => {
  const segments: FitnessCoordinate[][] = []
  let current: FitnessCoordinate[] = []

  for (const point of route) {
    if (isPointInAnyBounds(point, bounds)) {
      current.push(point)
    } else {
      if (current.length >= 2) {
        segments.push(current)
      }
      current = []
    }
  }

  if (current.length >= 2) {
    segments.push(current)
  }

  return segments
}

/**
 * Downsample a route segment for performance on the map.
 */
const downsampleRoute = (
  route: FitnessCoordinate[],
  maxPoints = 200
): FitnessCoordinate[] => {
  if (route.length <= maxPoints) return route

  const privacySegments: Array<
    PrivacySegment<FitnessCoordinate & { isHiddenByPrivacy: boolean }>
  > = [
    {
      isHiddenByPrivacy: false,
      points: route.map((coordinate) => ({
        ...coordinate,
        isHiddenByPrivacy: false
      }))
    }
  ]

  const result = downsamplePrivacySegments(privacySegments, maxPoints, {
    minimumPointsPerSegment: 2
  })

  if (result.length === 0 || result[0].points.length < 2) return route

  return result[0].points.map((p) => ({ lat: p.lat, lng: p.lng }))
}

/**
 * Generates a GeoJSON FeatureCollection of LineStrings from fitness route segments.
 */
export const getHeatmapGeoJSON = ({
  routeSegments,
  regionBounds
}: GetHeatmapGeoJSONParams): GeoJSONFeatureCollection<GeoJSONLineString> => {
  const hasRegions = regionBounds && regionBounds.length > 0

  const filteredSegments: FitnessCoordinate[][] = hasRegions
    ? routeSegments.flatMap((route) => splitRouteByBounds(route, regionBounds))
    : routeSegments

  const validRoutes = filteredSegments.filter((route) => route.length >= 2)

  const features = validRoutes.map((route) => {
    const sampledRoute = downsampleRoute(route)
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: sampledRoute.map((p) => [p.lng, p.lat] as [number, number])
      }
    }
  })

  return {
    type: 'FeatureCollection',
    features
  }
}
