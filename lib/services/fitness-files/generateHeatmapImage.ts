import sharp from 'sharp'

import type { RegionBounds } from '@/lib/fitness/regions'
import { downsamplePrivacySegments } from '@/lib/services/fitness-files/privacy'
import type { PrivacySegment } from '@/lib/services/fitness-files/privacy'

import type { FitnessCoordinate } from './mapUtils'
import {
  TILE_SIZE,
  calculateBounds,
  fetchOsmTile,
  getZoomLevel,
  project
} from './mapUtils'

export interface GenerateHeatmapImageParams {
  routeSegments: FitnessCoordinate[][]
  /**
   * When provided, coordinates are filtered to any of these bounding boxes and
   * the output image is cropped to the union of those bounds.
   *
   * Per PR #556: an OR check is applied across each individual bounds object so
   * that selecting Netherlands + Singapore does NOT include the sea in between.
   * Routes are also split at region boundaries (no artificial straight lines
   * across excluded areas).
   */
  regionBounds?: RegionBounds[]
  width?: number
  height?: number
}

const DEFAULT_WIDTH = 1200
const DEFAULT_HEIGHT = 900

/**
 * Returns true when the coordinate falls inside at least one of the provided
 * bounding boxes (OR logic — addresses PR #556 multi-region envelope issue).
 */
const isPointInAnyBounds = (
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

/**
 * Filter a single route segment to only the portions that lie within the given
 * region bounds.  Addresses PR #556: when a route exits and re-enters a region
 * the gap is represented as a segment break rather than a straight connecting
 * line.
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
 * Compute the union bounding box of all provided individual region bounds.
 * Used to set the heatmap image viewport when regions are selected.
 */
const mergeRegionBounds = (bounds: RegionBounds[]): RegionBounds => ({
  minLat: Math.min(...bounds.map((b) => b.minLat)),
  maxLat: Math.max(...bounds.map((b) => b.maxLat)),
  minLng: Math.min(...bounds.map((b) => b.minLng)),
  maxLng: Math.max(...bounds.map((b) => b.maxLng))
})

const downsampleRoute = (
  route: FitnessCoordinate[],
  maxPoints = 150
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

export const generateHeatmapImage = async ({
  routeSegments,
  regionBounds,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT
}: GenerateHeatmapImageParams): Promise<Buffer | null> => {
  const hasRegions = regionBounds && regionBounds.length > 0

  // When regions are specified, split each route at region boundaries (OR logic
  // per PR #556) so routes that exit and re-enter a region don't get connected
  // with an artificial straight line.
  const filteredSegments: FitnessCoordinate[][] = hasRegions
    ? routeSegments.flatMap((route) => splitRouteByBounds(route, regionBounds))
    : routeSegments

  const validRoutes = filteredSegments.filter((route) => route.length >= 2)
  if (validRoutes.length === 0) return null

  const allCoordinates = validRoutes.flat()
  if (allCoordinates.length < 2) return null

  // Use the union of the selected region bounds as the viewport; fall back to
  // auto-fitting around the actual coordinate data.
  const bounds = hasRegions
    ? mergeRegionBounds(regionBounds)
    : calculateBounds(allCoordinates)
  if (
    !Number.isFinite(bounds.minLat) ||
    !Number.isFinite(bounds.maxLat) ||
    !Number.isFinite(bounds.minLng) ||
    !Number.isFinite(bounds.maxLng)
  ) {
    return null
  }

  const padding = 64
  const zoom = getZoomLevel({ bounds, width, height, padding })

  const p1 = project({ lat: bounds.minLat, lng: bounds.minLng }, zoom)
  const p2 = project({ lat: bounds.maxLat, lng: bounds.maxLng }, zoom)
  const centerX = (p1.x + p2.x) / 2
  const centerY = (p1.y + p2.y) / 2
  const topLeftX = centerX - width / 2
  const topLeftY = centerY - height / 2

  const startTileX = Math.floor(topLeftX / TILE_SIZE)
  const endTileX = Math.floor((topLeftX + width) / TILE_SIZE)
  const startTileY = Math.floor(topLeftY / TILE_SIZE)
  const endTileY = Math.floor((topLeftY + height) / TILE_SIZE)

  const tileBuffers = await Promise.all(
    Array.from(
      { length: endTileY - startTileY + 1 },
      (_, yOffset) => startTileY + yOffset
    ).flatMap((tileY) =>
      Array.from(
        { length: endTileX - startTileX + 1 },
        (_, xOffset) => startTileX + xOffset
      ).map(async (tileX) => {
        const tile = await fetchOsmTile(zoom, tileX, tileY)
        return {
          input: tile,
          left: Math.round(tileX * TILE_SIZE - topLeftX),
          top: Math.round(tileY * TILE_SIZE - topLeftY)
        }
      })
    )
  )

  // Downsample each route to reduce SVG complexity
  const sampledRoutes = validRoutes.map((route) => downsampleRoute(route))

  // Project and render each route as a semi-transparent polyline
  const polylines = sampledRoutes
    .map((route) => {
      const points = route
        .map((c) => {
          const p = project(c, zoom)
          return `${(p.x - topLeftX).toFixed(2)},${(p.y - topLeftY).toFixed(2)}`
        })
        .join(' ')
      return `<polyline points="${points}" fill="none" stroke="#ff3b30" stroke-width="3" stroke-opacity="0.15" stroke-linecap="round" stroke-linejoin="round"/>`
    })
    .join('')

  const overlay = Buffer.from(
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">` +
      polylines +
      `</svg>`
  )

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: '#f8fafc'
    }
  })
    .composite([...tileBuffers, { input: overlay, top: 0, left: 0 }])
    .png()
    .toBuffer()
}
