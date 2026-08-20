import type { Database } from '@/lib/database/types'
import {
  RegionBounds,
  deserializeRegions,
  getRegionBounds
} from '@/lib/fitness/regions'
import { flattenTilePrivacyForPublic } from '@/lib/services/fitness-files/publicHeatmap'
import { FitnessRouteHeatmapPyramid } from '@/lib/types/database/fitnessRouteHeatmapTile'

import { MAX_TILES_PER_REQUEST, TILE_LADDER_ZOOMS } from './constants'
import { TileSegment, decodeTile, encodeTile, tileKey } from './tileCodec'
import {
  classifyTileAgainstRegion,
  clipTileSegmentsToRegion
} from './tileRegion'

export interface TileIndex {
  x: number
  y: number
}

/** `"x:y"` — the key a served tile is returned under, `z` being request-wide. */
export const tileIndexKey = ({ x, y }: TileIndex) => `${x}:${y}`

const TILE_INDEX_PART = /^\d+$/

/**
 * Parses the `tiles` query parameter — a comma-separated `x:y` list — or null
 * for anything malformed, out of range, or longer than one request may ask for.
 *
 * Over-length is REJECTED rather than truncated: a client that silently got
 * half its viewport back would render a map with holes it has no way to notice.
 *
 * Each part is matched against digits before `Number` sees it, for the reason
 * `parseTileKey` gives: `Number('')` is 0, so a truncated `"12:"` would resolve
 * to a real but different tile instead of being turned away.
 */
export const parseTileIndexList = (
  raw: string,
  z: number
): TileIndex[] | null => {
  const parts = raw.split(',')
  if (parts.length > MAX_TILES_PER_REQUEST) return null

  const limit = 2 ** z
  const tiles: TileIndex[] = []
  for (const part of parts) {
    const [rawX, rawY, ...rest] = part.split(':')
    if (rest.length > 0) return null
    if (!TILE_INDEX_PART.test(rawX ?? '')) return null
    if (!TILE_INDEX_PART.test(rawY ?? '')) return null

    const x = Number(rawX)
    const y = Number(rawY)
    if (x >= limit || y >= limit) return null

    tiles.push({ x, y })
  }

  return tiles
}

/**
 * The bounds a SHARED heatmap's tiles must be clipped to, or null when the
 * share names a region this server cannot resolve.
 *
 * Fails closed, and that is the whole point. `getRegionBounds` answers `[]` for
 * the whole world and for a region string it could not parse a single rectangle
 * out of, and `[]` means "clip nothing" everywhere downstream — so serving a
 * rect share whose stored token failed to parse would hand back the world
 * pyramid the share was cut from, which is the one outcome the public tile
 * route exists to prevent. Only the empty string, the explicit world sentinel
 * `serializeRegions` emits, reaches the unclipped path.
 *
 * A stored region can only ever be that sentinel or a `rect:` list, so the
 * refusal is for a value no writer produces. It stays because the cost of being
 * wrong is asymmetric: a false refusal drops the share back to the untiled
 * geometry the page already carries, while a false pass publishes the actor's
 * entire history.
 */
export const resolveShareRegionBounds = (
  region: string
): RegionBounds[] | null => {
  const bounds = getRegionBounds(deserializeRegions(region))
  if (bounds.length > 0) return bounds
  return region.trim() === '' ? [] : null
}

export const isLadderZoom = (z: number): boolean =>
  (TILE_LADDER_ZOOMS as readonly number[]).includes(z)

interface ServeHeatmapTilesParams {
  database: Database
  actorId: string
  /** The actor's pyramid row, already read by the caller; null when unbuilt. */
  pyramid: FitnessRouteHeatmapPyramid | null
  z: number
  tiles: TileIndex[]
  /** Region to clip to. Empty means world scope — nothing is clipped. */
  regionBounds: RegionBounds[]
  /**
   * Drop the privacy class from every run, keeping its geometry. Set for public
   * surfaces; see `flattenPrivacySegmentsForPublic` for why the geometry stays.
   */
  stripPrivacy: boolean
}

export interface ServedHeatmapTiles {
  /**
   * The version the returned tiles were built at, or 0 when none were served.
   * A client comparing it against the version it asked for learns that the
   * pyramid was rebuilt underneath it and its cached tiles are now stale.
   */
  version: number
  /** Every requested tile, `null` for empty, clipped away, or unavailable. */
  tiles: Record<string, string | null>
}

/**
 * Answers a batch of tiles for one actor, clipped to a region and optionally
 * stripped of the privacy class.
 *
 * Only a `completed` pyramid serves anything. A build in flight has tiles from
 * two versions in the table at once — the previous build's, wherever it has not
 * reached yet, and its own partial ones — and drawing those together would show
 * heat that no build ever produced. Callers that must distinguish "no tiles"
 * from "empty tiles" read the returned `version`, which is 0 in that case.
 *
 * Tiles at any other version are answered as empty for the same reason. That is
 * not merely belt-and-braces: completion's stale sweep runs in its own
 * try/catch and a build that completes after the sweep throws leaves exactly
 * those leftovers behind.
 */
export const serveHeatmapTiles = async ({
  database,
  actorId,
  pyramid,
  z,
  tiles,
  regionBounds,
  stripPrivacy
}: ServeHeatmapTilesParams): Promise<ServedHeatmapTiles> => {
  const served: Record<string, string | null> = {}
  for (const tile of tiles) served[tileIndexKey(tile)] = null

  if (!pyramid || pyramid.status !== 'completed' || pyramid.version < 1) {
    return { version: 0, tiles: served }
  }

  // Out-of-region tiles are settled here, before any read: a request scoped to
  // a shared rect must not be able to turn the world pyramid into a lookup
  // oracle, and answering them costs nothing.
  const readable = tiles.filter(
    (tile) =>
      classifyTileAgainstRegion(z, tile.x, tile.y, regionBounds) !== 'outside'
  )
  if (readable.length === 0) return { version: pyramid.version, tiles: served }

  const rows = await database.getFitnessRouteHeatmapTilesByKeys({
    actorId,
    tileKeys: readable.map((tile) => tileKey(z, tile.x, tile.y))
  })

  // Walked from the REQUEST, not from the rows: the response's keys are then
  // exactly the ones asked for, whatever the read came back with, and a client
  // can tell an empty tile from one it never asked about.
  const rowsByKey = new Map(
    rows.map((row) => [tileKey(row.z, row.x, row.y), row])
  )

  for (const tile of readable) {
    const row = rowsByKey.get(tileKey(z, tile.x, tile.y))
    if (!row || row.version !== pyramid.version) continue

    const overlap = classifyTileAgainstRegion(z, tile.x, tile.y, regionBounds)
    // Untouched geometry can be forwarded as stored, which is the whole-tile
    // case a viewport is mostly made of. The public path never takes it: every
    // byte it returns is re-encoded from segments `decodeTile` validated.
    if (overlap === 'inside' && !stripPrivacy) {
      served[tileIndexKey(tile)] = row.segments
      continue
    }

    let segments: TileSegment[] = decodeTile(row.segments)
    if (overlap === 'partial') {
      segments = clipTileSegmentsToRegion(
        z,
        tile.x,
        tile.y,
        segments,
        regionBounds
      )
    }
    if (stripPrivacy) {
      segments = flattenTilePrivacyForPublic(segments)
    }

    served[tileIndexKey(tile)] =
      segments.length > 0 ? encodeTile(segments) : null
  }

  return { version: pyramid.version, tiles: served }
}
