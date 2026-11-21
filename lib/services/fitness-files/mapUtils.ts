import sharp from 'sharp'

import { readResponseArrayBufferWithLimit } from '@/lib/utils/streamLimit'
import {
  MAX_LATITUDE,
  MIN_LATITUDE,
  TILE_SIZE,
  calculateCoordinateBounds,
  clampLatitude,
  getZoomLevelForBounds,
  normalizeLongitude,
  projectWebMercator
} from '@/lib/utils/webMercator'

import { FitnessCoordinate } from './parseFitnessFile'

// A tile is a few tens of kilobytes; the cap only stops a hostile or broken
// tile server from buffering an unbounded body. The deadline bounds a server
// that accepts the connection and then stalls.
const OSM_TILE_TIMEOUT_MS = 10_000
const OSM_TILE_MAX_BYTES = 1024 * 1024

export type { FitnessCoordinate }

export {
  MAX_LATITUDE,
  MIN_LATITUDE,
  TILE_SIZE,
  clampLatitude,
  normalizeLongitude
}

export const project = projectWebMercator
export const calculateBounds = calculateCoordinateBounds
export type CoordinateBounds = ReturnType<typeof calculateBounds>

export const getZoomLevel = ({
  coordinates,
  bounds: precomputedBounds,
  width,
  height,
  padding
}: {
  coordinates?: FitnessCoordinate[]
  bounds?: CoordinateBounds
  width: number
  height: number
  padding: number
}) => {
  return getZoomLevelForBounds({
    coordinates,
    bounds: precomputedBounds,
    width,
    height,
    padding
  })
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
    },
    signal: AbortSignal.timeout(OSM_TILE_TIMEOUT_MS)
  })

  if (!response.ok) {
    throw new Error(
      `Failed to fetch OSM tile ${zoom}/${wrappedX}/${tileY}: ${response.status}`
    )
  }

  return Buffer.from(
    await readResponseArrayBufferWithLimit(
      response,
      OSM_TILE_MAX_BYTES,
      'OSM tile'
    )
  )
}
