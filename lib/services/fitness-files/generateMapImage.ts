import sharp from 'sharp'

import { getConfig } from '@/lib/config'
import { logger } from '@/lib/utils/logger'

import { FitnessCoordinate } from './parseFitnessFile'

export interface GenerateMapImageParams {
  coordinates: FitnessCoordinate[]
  width?: number
  height?: number
}

const DEFAULT_WIDTH = 800
const DEFAULT_HEIGHT = 600
const TILE_SIZE = 256
const MIN_LATITUDE = -85.05112878
const MAX_LATITUDE = 85.05112878

const clampLatitude = (latitude: number) =>
  Math.min(MAX_LATITUDE, Math.max(MIN_LATITUDE, latitude))

const normalizeLongitude = (longitude: number) => {
  if (longitude > 180) return longitude - 360
  if (longitude < -180) return longitude + 360
  return longitude
}

const project = (coordinate: FitnessCoordinate, zoom: number) => {
  const scale = 2 ** zoom * TILE_SIZE
  const lng = normalizeLongitude(coordinate.lng)
  const lat = clampLatitude(coordinate.lat)

  const x = ((lng + 180) / 360) * scale
  const latRad = (lat * Math.PI) / 180
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
    scale

  return { x, y }
}

const calculateBounds = (coordinates: FitnessCoordinate[]) => {
  let minLat = Number.POSITIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY
  let minLng = Number.POSITIVE_INFINITY
  let maxLng = Number.NEGATIVE_INFINITY

  for (const coordinate of coordinates) {
    minLat = Math.min(minLat, coordinate.lat)
    maxLat = Math.max(maxLat, coordinate.lat)
    minLng = Math.min(minLng, coordinate.lng)
    maxLng = Math.max(maxLng, coordinate.lng)
  }

  return {
    minLat,
    maxLat,
    minLng,
    maxLng
  }
}

const downsampleCoordinates = (
  coordinates: FitnessCoordinate[],
  maxPoints = 500
): FitnessCoordinate[] => {
  if (coordinates.length <= maxPoints) return coordinates

  const step = coordinates.length / maxPoints
  const sampled: FitnessCoordinate[] = []

  for (let index = 0; index < maxPoints; index += 1) {
    sampled.push(coordinates[Math.floor(index * step)])
  }

  const lastCoordinate = coordinates[coordinates.length - 1]
  if (sampled[sampled.length - 1] !== lastCoordinate) {
    sampled.push(lastCoordinate)
  }

  return sampled
}

const buildMapboxUrl = ({
  coordinates,
  width,
  height,
  accessToken
}: {
  coordinates: FitnessCoordinate[]
  width: number
  height: number
  accessToken: string
}) => {
  const sampledCoordinates = downsampleCoordinates(coordinates)
  const geoJson = {
    type: 'Feature',
    properties: {
      stroke: '#ff3b30',
      'stroke-width': 4,
      'stroke-opacity': 0.9
    },
    geometry: {
      type: 'LineString',
      coordinates: sampledCoordinates.map((coordinate) => [
        coordinate.lng,
        coordinate.lat
      ])
    }
  }

  const encodedGeoJson = encodeURIComponent(JSON.stringify(geoJson))

  return (
    `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/static/` +
    `geojson(${encodedGeoJson})/auto/${width}x${height}` +
    `?padding=48&access_token=${encodeURIComponent(accessToken)}`
  )
}

const getZoomLevel = ({
  coordinates,
  width,
  height,
  padding
}: {
  coordinates: FitnessCoordinate[]
  width: number
  height: number
  padding: number
}) => {
  for (let zoom = 18; zoom >= 2; zoom -= 1) {
    const projected = coordinates.map((coordinate) => project(coordinate, zoom))
    const xValues = projected.map((point) => point.x)
    const yValues = projected.map((point) => point.y)

    const minX = Math.min(...xValues)
    const maxX = Math.max(...xValues)
    const minY = Math.min(...yValues)
    const maxY = Math.max(...yValues)

    if (
      maxX - minX <= width - padding * 2 &&
      maxY - minY <= height - padding * 2
    ) {
      return zoom
    }
  }

  return 2
}

const fetchOsmTile = async (
  zoom: number,
  tileX: number,
  tileY: number
): Promise<Buffer> => {
  const worldSize = 2 ** zoom

  if (tileY < 0 || tileY >= worldSize) {
    return sharp({
      create: {
        width: TILE_SIZE,
        height: TILE_SIZE,
        channels: 4,
        background: '#e5e7eb'
      }
    })
      .png()
      .toBuffer()
  }

  const wrappedX = ((tileX % worldSize) + worldSize) % worldSize
  const url = `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${tileY}.png`

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'activities.next/fitness-map'
    }
  })

  if (!response.ok) {
    throw new Error(
      `Failed to fetch OSM tile ${zoom}/${wrappedX}/${tileY}: ${response.status}`
    )
  }

  return Buffer.from(await response.arrayBuffer())
}

const renderOsmMap = async ({
  coordinates,
  width,
  height
}: {
  coordinates: FitnessCoordinate[]
  width: number
  height: number
}): Promise<Buffer> => {
  const padding = 56
  const zoom = getZoomLevel({ coordinates, width, height, padding })
  const projected = coordinates.map((coordinate) => project(coordinate, zoom))

  const xValues = projected.map((point) => point.x)
  const yValues = projected.map((point) => point.y)

  const minX = Math.min(...xValues)
  const maxX = Math.max(...xValues)
  const minY = Math.min(...yValues)
  const maxY = Math.max(...yValues)

  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
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

  const screenPoints = projected.map((point) => ({
    x: point.x - topLeftX,
    y: point.y - topLeftY
  }))

  const polyline = screenPoints
    .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(' ')

  const start = screenPoints[0]
  const end = screenPoints[screenPoints.length - 1]

  const overlay = Buffer.from(
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">` +
      `<polyline points="${polyline}" fill="none" stroke="#ff3b30" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<circle cx="${start.x.toFixed(2)}" cy="${start.y.toFixed(2)}" r="5" fill="#16a34a" stroke="#ffffff" stroke-width="2"/>` +
      `<circle cx="${end.x.toFixed(2)}" cy="${end.y.toFixed(2)}" r="5" fill="#dc2626" stroke="#ffffff" stroke-width="2"/>` +
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

export const generateMapImage = async ({
  coordinates,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT
}: GenerateMapImageParams): Promise<Buffer | null> => {
  if (coordinates.length < 2) {
    return null
  }

  const bounds = calculateBounds(coordinates)

  if (
    !Number.isFinite(bounds.minLat) ||
    !Number.isFinite(bounds.maxLat) ||
    !Number.isFinite(bounds.minLng) ||
    !Number.isFinite(bounds.maxLng)
  ) {
    return null
  }

  const mapboxAccessToken =
    getConfig().fitnessStorage?.mapboxAccessToken?.trim() ?? ''

  if (mapboxAccessToken.length > 0) {
    try {
      const response = await fetch(
        buildMapboxUrl({
          coordinates,
          width,
          height,
          accessToken: mapboxAccessToken
        })
      )

      if (!response.ok) {
        throw new Error(`Mapbox request failed with status ${response.status}`)
      }

      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      const nodeError = error as Error
      logger.warn({
        message: 'Mapbox map rendering failed; using OSM fallback',
        error: nodeError.message
      })
    }
  }

  return renderOsmMap({ coordinates, width, height })
}
