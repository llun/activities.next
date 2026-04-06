import sharp from 'sharp'

import { FitnessCoordinate } from './parseFitnessFile'

export type { FitnessCoordinate }

export const TILE_SIZE = 256
export const MIN_LATITUDE = -85.05112878
export const MAX_LATITUDE = 85.05112878

export const clampLatitude = (latitude: number) =>
  Math.min(MAX_LATITUDE, Math.max(MIN_LATITUDE, latitude))

export const normalizeLongitude = (longitude: number) => {
  if (longitude > 180) return longitude - 360
  if (longitude < -180) return longitude + 360
  return longitude
}

export const project = (coordinate: FitnessCoordinate, zoom: number) => {
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

export const calculateBounds = (coordinates: FitnessCoordinate[]) => {
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

export const getZoomLevel = ({
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
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const coordinate of coordinates) {
      const { x, y } = project(coordinate, zoom)
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }

    if (
      maxX - minX <= width - padding * 2 &&
      maxY - minY <= height - padding * 2
    ) {
      return zoom
    }
  }

  return 2
}

export const fetchOsmTile = async (
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
