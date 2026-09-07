import type { HeatmapTileSource } from '@/lib/services/fitness-files/heatmapTiles/tileSource'
import { toIdPathSegment } from '@/lib/utils/urlToId'

import { parseApiError } from './http'

// Fitness Route Heatmap

export interface FitnessRouteHeatmapPoint {
  lat: number
  lng: number
}

export interface FitnessRouteHeatmapSegment {
  isHiddenByPrivacy?: boolean
  points: FitnessRouteHeatmapPoint[]
}

export interface FitnessRouteHeatmapBounds {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

/**
 * How to fetch the tiled version of a heatmap, or absent/null when the heatmap
 * has none and its own `segments` are all there is. Structurally the server's
 * `HeatmapTileSource`, aliased here so client code names it alongside the rest
 * of the heatmap payload.
 */
export type FitnessRouteHeatmapTileSource = HeatmapTileSource

/** One batch of tiles: the payload string per `"x:y"`, `null` where empty. */
export interface FitnessRouteHeatmapTileBatch {
  /**
   * The version the tiles were actually built at, which is 0 when none were
   * served. A client holding a different version has been overtaken by a
   * rebuild and should drop what it cached rather than mix the two.
   */
  version: number
  tiles: Record<string, string | null>
}

export interface FitnessRouteHeatmapData {
  id: string
  activityType?: string
  periodType: string
  periodKey: string
  region?: string | null
  status: string
  bounds?: FitnessRouteHeatmapBounds | null
  segments: FitnessRouteHeatmapSegment[]
  activityCount: number
  pointCount: number
  /** Total matching files to scan; progress denominator. 0 = not yet computed. */
  totalCount: number
  cursorOffset: number
  isPartial: boolean
  /** Opt-in public embed token; null/undefined when the heatmap is private. */
  shareToken?: string | null
  error?: string | null
  tileSource?: FitnessRouteHeatmapTileSource | null
  createdAt: number
  updatedAt: number
}

export interface FitnessRouteHeatmapSummaryData {
  id: string
  activityType?: string
  periodType: string
  periodKey: string
  region?: string | null
  status: string
  activityCount: number
  pointCount: number
  /** Total matching files to scan; progress denominator. 0 = not yet computed. */
  totalCount: number
  cursorOffset: number
  isPartial: boolean
  error?: string | null
  createdAt: number
  updatedAt: number
}

const getRouteHeatmapResponseErrorMessage = async (
  response: Response,
  label: string
) => {
  const detail = await parseApiError(response, '')
  return `Failed to load ${label} (${response.status})${detail ? `: ${detail}` : '.'}`
}

/**
 * Loads the focused route-heatmap cache. Non-OK responses are thrown instead of
 * coerced to null so the UI can distinguish a failed read from a cache miss.
 */
export const getFitnessRouteHeatmap = async ({
  actorId,
  activityType,
  periodType,
  periodKey,
  region
}: {
  actorId: string
  activityType?: string
  periodType: string
  periodKey: string
  /** Serialized region scope (sorted `rect:` tokens). Omit/empty for world-wide. */
  region?: string | null
}): Promise<FitnessRouteHeatmapData | null> => {
  const encodedId = toIdPathSegment(actorId)
  const url = new URL(
    `${window.origin}/api/v1/accounts/${encodedId}/fitness-route-heatmap`
  )
  url.searchParams.append('period_type', periodType)
  url.searchParams.append('period_key', periodKey)
  if (activityType) {
    url.searchParams.append('activity_type', activityType)
  }
  if (region) {
    url.searchParams.append('region', region)
  }
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) {
    throw new Error(
      await getRouteHeatmapResponseErrorMessage(response, 'route heatmap')
    )
  }
  try {
    const json = await response.json()
    if (json && typeof json === 'object' && 'heatmap' in json) {
      return json.heatmap as FitnessRouteHeatmapData | null
    }
    return json as FitnessRouteHeatmapData | null
  } catch {
    return null
  }
}

export interface FitnessRouteHeatmapTileRequest {
  /** A ladder zoom (see `TILE_LADDER_ZOOMS`); anything else is a 400. */
  z: number
  /** Up to `MAX_TILES_PER_REQUEST` tile indices at that zoom. */
  tiles: Array<{ x: number; y: number }>
  /**
   * The `tileSource` version these tiles are being fetched for. It makes the
   * URL change when the pyramid is rebuilt — which is all it does: the server
   * answers with whatever it currently has and reports that version back, so a
   * stale value never turns into a refused request.
   */
  version: number
  /** Aborts the request when the viewport moves on. */
  signal?: AbortSignal
}

const toTilesParam = (tiles: Array<{ x: number; y: number }>) =>
  tiles.map(({ x, y }) => `${x}:${y}`).join(',')

const readTileBatch = async (
  response: Response
): Promise<FitnessRouteHeatmapTileBatch> => {
  if (!response.ok) {
    throw new Error(
      await getRouteHeatmapResponseErrorMessage(response, 'route heatmap tiles')
    )
  }
  return (await response.json()) as FitnessRouteHeatmapTileBatch
}

/** Loads a batch of the signed-in actor's own route heatmap tiles. */
export const getFitnessRouteHeatmapTiles = async ({
  actorId,
  region,
  z,
  tiles,
  version,
  signal
}: FitnessRouteHeatmapTileRequest & {
  actorId: string
  /** Serialized region scope to clip to. Omit/empty for world-wide. */
  region?: string | null
}): Promise<FitnessRouteHeatmapTileBatch> => {
  const encodedId = toIdPathSegment(actorId)
  const url = new URL(
    `${window.origin}/api/v1/accounts/${encodedId}/fitness-route-heatmap/tiles`
  )
  url.searchParams.append('z', String(z))
  url.searchParams.append('tiles', toTilesParam(tiles))
  url.searchParams.append('v', String(version))
  if (region) {
    url.searchParams.append('region', region)
  }
  return readTileBatch(
    await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal
    })
  )
}

/**
 * The same for a public share, addressed by its token. The region is NOT a
 * parameter here: the server clips to the shared row's own scope, which is what
 * keeps a rect share from reaching the rest of the pyramid.
 *
 * Where the owner route answers `version: 0` for a share with no usable
 * pyramid, this one 404s — it refuses rather than describes, because a share
 * scoped to one sport or one year must not be answered from the whole-history
 * pyramid at all. That 404 is translated here into the same `version: 0` the
 * shared type documents, so both fetchers honour one contract and a caller has
 * a single "no tiles, draw the untiled geometry" branch. Every other non-OK
 * response still throws.
 */
export const getPublicHeatmapTiles = async ({
  token,
  z,
  tiles,
  version,
  signal
}: FitnessRouteHeatmapTileRequest & {
  token: string
}): Promise<FitnessRouteHeatmapTileBatch> => {
  const url = new URL(
    `${window.origin}/embed/heatmap/${encodeURIComponent(token)}/tiles`
  )
  url.searchParams.append('z', String(z))
  url.searchParams.append('tiles', toTilesParam(tiles))
  url.searchParams.append('v', String(version))
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal
  })
  if (response.status === 404) {
    return {
      version: 0,
      tiles: Object.fromEntries(tiles.map(({ x, y }) => [`${x}:${y}`, null]))
    }
  }
  return readTileBatch(response)
}

export const triggerFitnessRouteHeatmap = async ({
  actorId,
  activityType,
  periodType,
  periodKey,
  region,
  retry
}: {
  actorId: string
  activityType?: string
  periodType: string
  periodKey: string
  region?: string | null
  retry?: boolean
}): Promise<boolean> => {
  const encodedId = toIdPathSegment(actorId)
  const response = await fetch(
    `${window.origin}/api/v1/accounts/${encodedId}/fitness-route-heatmap`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        period_type: periodType,
        period_key: periodKey,
        ...(activityType ? { activity_type: activityType } : {}),
        ...(region ? { region } : {}),
        ...(retry ? { retry } : {})
      })
    }
  )
  return response.ok
}

/**
 * Cancels an in-flight route-heatmap generation for a region. Resolves to true
 * when a run was actually cancelled (false when nothing was in flight).
 */
export const cancelFitnessRouteHeatmap = async ({
  actorId,
  activityType,
  periodType,
  periodKey,
  region
}: {
  actorId: string
  activityType?: string
  periodType: string
  periodKey: string
  region?: string | null
}): Promise<boolean> => {
  const encodedId = toIdPathSegment(actorId)
  const response = await fetch(
    `${window.origin}/api/v1/accounts/${encodedId}/fitness-route-heatmap`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        period_type: periodType,
        period_key: periodKey,
        ...(activityType ? { activity_type: activityType } : {}),
        ...(region ? { region } : {}),
        cancel: true
      })
    }
  )
  if (!response.ok) {
    throw new Error(
      await getRouteHeatmapResponseErrorMessage(response, 'route heatmap')
    )
  }
  const json = await response.json()
  return Boolean(json.cancelled)
}

/**
 * Enables public sharing for a single route heatmap (identified by its
 * activity/period/region key) and returns its embed share token. Idempotent: a
 * heatmap that is already shared keeps its existing token.
 */
export const shareFitnessRouteHeatmap = async ({
  actorId,
  activityType,
  periodType,
  periodKey,
  region
}: {
  actorId: string
  activityType?: string
  periodType: string
  periodKey: string
  region?: string | null
}): Promise<string> => {
  const encodedId = toIdPathSegment(actorId)
  const response = await fetch(
    `${window.origin}/api/v1/accounts/${encodedId}/fitness-route-heatmap/share`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        period_type: periodType,
        period_key: periodKey,
        ...(activityType ? { activity_type: activityType } : {}),
        ...(region ? { region } : {})
      })
    }
  )
  if (!response.ok) {
    throw new Error(
      await getRouteHeatmapResponseErrorMessage(response, 'heatmap share')
    )
  }
  const json = await response.json()
  return json.shareToken as string
}

/**
 * Disables public sharing (revokes the embed token) for a single route heatmap.
 */
export const unshareFitnessRouteHeatmap = async ({
  actorId,
  activityType,
  periodType,
  periodKey,
  region
}: {
  actorId: string
  activityType?: string
  periodType: string
  periodKey: string
  region?: string | null
}): Promise<void> => {
  const encodedId = toIdPathSegment(actorId)
  const url = new URL(
    `${window.origin}/api/v1/accounts/${encodedId}/fitness-route-heatmap/share`
  )
  url.searchParams.append('period_type', periodType)
  url.searchParams.append('period_key', periodKey)
  if (activityType) {
    url.searchParams.append('activity_type', activityType)
  }
  if (region) {
    url.searchParams.append('region', region)
  }
  const response = await fetch(url.toString(), {
    method: 'DELETE',
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) {
    throw new Error(
      await getRouteHeatmapResponseErrorMessage(response, 'heatmap share')
    )
  }
}

/**
 * Soft-deletes a single route heatmap (identified by its activity/period/region
 * key) from the actor's list. Used to remove a failed or unwanted heatmap.
 * Resolves to true when a row was removed.
 */
export const deleteFitnessRouteHeatmap = async ({
  actorId,
  activityType,
  periodType,
  periodKey,
  region
}: {
  actorId: string
  activityType?: string
  periodType: string
  periodKey: string
  region?: string | null
}): Promise<boolean> => {
  const encodedId = toIdPathSegment(actorId)
  const url = new URL(
    `${window.origin}/api/v1/accounts/${encodedId}/fitness-route-heatmap`
  )
  url.searchParams.append('period_type', periodType)
  url.searchParams.append('period_key', periodKey)
  if (activityType) {
    url.searchParams.append('activity_type', activityType)
  }
  if (region) {
    url.searchParams.append('region', region)
  }
  const response = await fetch(url.toString(), {
    method: 'DELETE',
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) {
    throw new Error(
      await getRouteHeatmapResponseErrorMessage(response, 'route heatmap')
    )
  }
  const json = await response.json()
  return Boolean(json.deleted)
}

export const getFitnessRouteHeatmaps = async ({
  actorId
}: {
  actorId: string
}): Promise<FitnessRouteHeatmapSummaryData[]> => {
  const encodedId = toIdPathSegment(actorId)
  const response = await fetch(
    `${window.origin}/api/v1/accounts/${encodedId}/fitness-route-heatmaps`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' }
    }
  )
  if (!response.ok) {
    throw new Error(
      await getRouteHeatmapResponseErrorMessage(response, 'route heatmaps')
    )
  }
  const json = await response.json()
  return json.heatmaps as FitnessRouteHeatmapSummaryData[]
}

export const clearFitnessRouteHeatmaps = async ({
  actorId
}: {
  actorId: string
}): Promise<number> => {
  const encodedId = toIdPathSegment(actorId)
  const response = await fetch(
    `${window.origin}/api/v1/accounts/${encodedId}/fitness-route-heatmaps`,
    {
      method: 'DELETE',
      headers: { Accept: 'application/json' }
    }
  )
  if (!response.ok) {
    throw new Error(
      await getRouteHeatmapResponseErrorMessage(response, 'route heatmaps')
    )
  }
  const json = await response.json()
  return typeof json.deleted === 'number' ? json.deleted : 0
}

export interface FitnessRouteHeatmapRegionNameData {
  /** Serialized region scope (a single sorted `rect:` token). */
  region: string
  name: string
}

/** Loads the actor's saved region labels, keyed by serialized region scope. */
export const getFitnessRouteHeatmapRegionNames = async ({
  actorId
}: {
  actorId: string
}): Promise<FitnessRouteHeatmapRegionNameData[]> => {
  const encodedId = toIdPathSegment(actorId)
  const response = await fetch(
    `${window.origin}/api/v1/accounts/${encodedId}/fitness-route-heatmap-region-names`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' }
    }
  )
  if (!response.ok) return []
  try {
    const json = await response.json()
    return Array.isArray(json.names)
      ? (json.names as FitnessRouteHeatmapRegionNameData[])
      : []
  } catch {
    return []
  }
}

/**
 * Saves (or, with a blank/null name, clears) the label for one region. Resolves
 * to true when the server accepted the change.
 */
export const setFitnessRouteHeatmapRegionName = async ({
  actorId,
  region,
  name
}: {
  actorId: string
  region: string
  name: string | null
}): Promise<boolean> => {
  const encodedId = toIdPathSegment(actorId)
  const response = await fetch(
    `${window.origin}/api/v1/accounts/${encodedId}/fitness-route-heatmap-region-names`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ region, name })
    }
  )
  return response.ok
}
