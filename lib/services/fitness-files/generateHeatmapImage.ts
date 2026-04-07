import sharp from 'sharp'

import { downsamplePrivacySegments } from '@/lib/services/fitness-files/privacy'
import type { PrivacySegment } from '@/lib/services/fitness-files/privacy'

import type { CoordinateBounds, FitnessCoordinate } from './mapUtils'
import {
  TILE_SIZE,
  calculateBounds,
  fetchOsmTile,
  getZoomLevel,
  project
} from './mapUtils'

export interface GenerateHeatmapImageParams {
  routeSegments: FitnessCoordinate[][]
  width?: number
  height?: number
  /**
   * When provided, the map viewport is forced to these bounds instead of
   * being auto-fitted to the route data. Used for region-based heatmaps.
   */
  regionBounds?: CoordinateBounds
}

const DEFAULT_WIDTH = 1200
const DEFAULT_HEIGHT = 900

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
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  regionBounds
}: GenerateHeatmapImageParams): Promise<Buffer | null> => {
  const validRoutes = routeSegments.filter((route) => route.length >= 2)
  if (validRoutes.length === 0) return null

  const allCoordinates = validRoutes.flat()
  if (allCoordinates.length < 2) return null

  const bounds = regionBounds ?? calculateBounds(allCoordinates)
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
