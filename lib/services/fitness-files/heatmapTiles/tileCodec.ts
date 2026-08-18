import {
  TILE_SIZE,
  clampLatitude,
  projectWebMercator
} from '@/lib/utils/webMercator'

import { TILE_EXTENT, TILE_MAX_ZOOM, TILE_MIN_ZOOM } from './constants'

/**
 * The tile payload format, and the projection helpers that produce it.
 *
 * Dependency-free apart from the shared Web Mercator maths, and carries no
 * `'use client'`: the build job, the serving routes and the map components all
 * decode with this (see AGENTS.md → Server/Client Module Boundary). The
 * database layer deliberately treats a tile's payload as an opaque string and
 * never parses it, so this module is the ONLY definition of the format.
 */

/**
 * One run of connected pixels within a tile, all sharing a visit count and a
 * privacy class.
 *
 * `points` is a FLAT `[x0, y0, x1, y1, …]` array rather than a list of pairs:
 * it is about half the JSON of `[[x,y],…]` and parses proportionally faster,
 * and since every value is an integer in `0..TILE_EXTENT` the encoding is exact
 * — nothing here round-trips through a float.
 */
export interface TileSegment {
  /** How many distinct activities traced this run. */
  count: number
  /**
   * Set only when the run is privacy-trimmed geometry, mirroring how the
   * untiled format omits `isHiddenByPrivacy` for the ordinary case.
   */
  hidden?: boolean
  points: number[]
}

export interface TileCoordinate {
  z: number
  x: number
  y: number
}

/** `"z:x:y"`, matching the `tileKey` column the pyramid is keyed by. */
export const tileKey = (z: number, x: number, y: number) => `${z}:${x}:${y}`

const TILE_KEY_PART = /^\d+$/

/**
 * The inverse of `tileKey`, or null for anything that is not one. A key can
 * arrive from a query string, so this rejects rather than coerces.
 *
 * Each part is matched against digits before `Number` sees it, because
 * `Number('')` is 0 — so a truncated `"12:2103:"` would otherwise resolve to a
 * real but entirely different tile instead of being turned away, as would
 * `"0x4:1:1"` and `" 4 :1:1"`. The zoom is bounded by the ladder for the same
 * reason: above zoom 1023 `2 ** z` is `Infinity`, which makes the index checks
 * below vacuous.
 */
export const parseTileKey = (key: string): TileCoordinate | null => {
  const parts = key.split(':')
  if (parts.length !== 3) return null
  if (!parts.every((part) => TILE_KEY_PART.test(part))) return null

  const [z, x, y] = parts.map((part) => Number(part))
  if (z < TILE_MIN_ZOOM || z > TILE_MAX_ZOOM) return null
  if (x >= 2 ** z || y >= 2 ** z) return null

  return { z, x, y }
}

/** The number of tiles along one axis at a zoom. */
export const tileCountAtZoom = (zoom: number) => 2 ** zoom

/**
 * Places a coordinate in the tile grid: which tile owns it, and where inside
 * that tile it sits in the `0..TILE_EXTENT` local space.
 *
 * The index is clamped at BOTH ends, because the projection's own edges fall
 * outside the grid at both. `lng = +180` and any latitude at or below the
 * Mercator clamp project to exactly `scale`, whose floor is `2**zoom` — one
 * past the last tile; and the northern limit projects to a hair under zero, so
 * its floor is `-1`. Those points belong to the edge tiles, at local coordinate
 * `TILE_EXTENT` and `0` respectively, not to tiles that do not exist.
 */
export const lngLatToTileLocal = (
  coordinate: { lat: number; lng: number },
  zoom: number
) => {
  const projected = projectWebMercator(coordinate, zoom)
  const continuousX = projected.x / TILE_SIZE
  const continuousY = projected.y / TILE_SIZE
  const lastTile = tileCountAtZoom(zoom) - 1
  const clampIndex = (index: number) => Math.min(Math.max(index, 0), lastTile)

  const x = clampIndex(Math.floor(continuousX))
  const y = clampIndex(Math.floor(continuousY))

  // Clamped for the same reason the index is: at the projection's own edges the
  // local coordinate lands a hair outside the space (the north Mercator limit
  // gives about -4e-7), and the space is what callers are promised.
  const clampLocal = (local: number) =>
    Math.min(Math.max(local, 0), TILE_EXTENT)

  return {
    x,
    y,
    u: clampLocal((continuousX - x) * TILE_EXTENT),
    v: clampLocal((continuousY - y) * TILE_EXTENT),
    continuousX,
    continuousY
  }
}

/**
 * The inverse: back from a tile-local pixel to the coordinate it stands for.
 * `projectWebMercator` has no inverse of its own, and the serving path needs
 * one to clip a tile to a shared region in degrees.
 */
export const tileLocalToLngLat = (
  z: number,
  x: number,
  y: number,
  u: number,
  v: number
) => {
  const scale = tileCountAtZoom(z)
  const worldX = (x + u / TILE_EXTENT) / scale
  const worldY = (y + v / TILE_EXTENT) / scale

  const lng = worldX * 360 - 180
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * worldY)))

  return { lat: (latRad * 180) / Math.PI, lng }
}

/**
 * The tile index range covering a bounding box at one zoom.
 *
 * Latitude is clamped to the Mercator limits, so a box reaching past them is
 * answered with the edge tiles rather than nothing. A box that wraps the
 * antimeridian is the CALLER's to split: this returns `minX > maxX` for one,
 * and the range read it feeds uses `whereBetween`, which matches no rows in
 * that state rather than wrapping around. An inverted box — `minLat` above
 * `maxLat` — comes back the same way on the other axis, and reads as empty for
 * the same reason.
 */
export const tilesForBounds = (
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  zoom: number
) => {
  const lastTile = tileCountAtZoom(zoom) - 1
  const clampIndex = (index: number) => Math.min(Math.max(index, 0), lastTile)

  // North is a SMALLER y in Mercator, so the max latitude gives minY.
  const topLeft = lngLatToTileLocal(
    { lat: clampLatitude(bounds.maxLat), lng: bounds.minLng },
    zoom
  )
  const bottomRight = lngLatToTileLocal(
    { lat: clampLatitude(bounds.minLat), lng: bounds.maxLng },
    zoom
  )

  return {
    z: zoom,
    minX: clampIndex(topLeft.x),
    maxX: clampIndex(bottomRight.x),
    minY: clampIndex(topLeft.y),
    maxY: clampIndex(bottomRight.y)
  }
}

interface EncodedSegment {
  c: number
  h?: number
  p: number[]
}

interface EncodedTile {
  e: number
  s: EncodedSegment[]
}

/**
 * `{"e":256,"s":[{"c":3,"h":1,"p":[x0,y0,…]}]}`.
 *
 * `h` is omitted entirely for visible geometry, the same way the untiled format
 * omits `isHiddenByPrivacy`, so the common case costs nothing. `e` records the
 * extent the coordinates are in: it is redundant with `TILE_EXTENT` today, and
 * kept only because the row's `version` column counts BUILDS (it drives the
 * stale sweep) and so cannot signal a format change — this is the one field
 * that could.
 */
export const encodeTile = (segments: TileSegment[]) => {
  const encoded: EncodedTile = {
    e: TILE_EXTENT,
    s: segments.map((segment) => ({
      c: segment.count,
      ...(segment.hidden ? { h: 1 } : {}),
      p: segment.points
    }))
  }
  return JSON.stringify(encoded)
}

const isValidPointList = (points: unknown): points is number[] =>
  Array.isArray(points) &&
  points.length >= 4 &&
  points.length % 2 === 0 &&
  points.every(
    (value) =>
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= TILE_EXTENT
  )

/**
 * The inverse, and deliberately tolerant: anything unreadable answers `[]` and
 * a single unreadable segment is dropped rather than taking the tile with it. A
 * corrupt tile is a missing tile — the pyramid is a cache, and throwing here
 * would turn one bad row into a failed map.
 */
export const decodeTile = (
  encoded: string | null | undefined
): TileSegment[] => {
  if (!encoded) return []

  try {
    const parsed: unknown = JSON.parse(encoded)
    if (!parsed || typeof parsed !== 'object') return []

    const segments = (parsed as { s?: unknown }).s
    if (!Array.isArray(segments)) return []

    return segments.flatMap((segment): TileSegment[] => {
      if (!segment || typeof segment !== 'object') return []

      const { c, h, p } = segment as EncodedSegment
      if (!isValidPointList(p)) return []
      if (typeof c !== 'number' || !Number.isFinite(c) || c < 1) return []

      return [
        {
          count: Math.round(c),
          ...(h ? { hidden: true } : {}),
          points: p
        }
      ]
    })
  } catch {
    return []
  }
}

/**
 * Vertices stored in a tile — what the pyramid's `pointCount` column holds, and
 * what its progress totals sum.
 */
export const countTilePoints = (segments: TileSegment[]) =>
  segments.reduce((total, segment) => total + segment.points.length / 2, 0)
