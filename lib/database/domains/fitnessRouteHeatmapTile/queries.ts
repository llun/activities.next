import {
  claimFitnessRouteHeatmapPyramidBuild,
  readPyramidRow
} from '@/lib/database/domains/fitnessRouteHeatmapTile/claim'
import {
  applyTileRange,
  toFitnessRouteHeatmapPyramid,
  toFitnessRouteHeatmapTileRow
} from '@/lib/database/domains/fitnessRouteHeatmapTile/rows'
import type { FitnessRouteHeatmapTileRangeParams } from '@/lib/database/domains/fitnessRouteHeatmapTile/types'
import { fitnessRouteHeatmapTileWrites } from '@/lib/database/domains/fitnessRouteHeatmapTile/writes'
import type { Db } from '@/lib/database/kysely'
import { selectInChunks } from '@/lib/database/kysely/inList'
import type {
  FitnessRouteHeatmapPyramid,
  FitnessRouteHeatmapTileRow
} from '@/lib/types/database/fitnessRouteHeatmapTile'

// The route heatmap pyramid reads. The claim is in ./claim.ts and the other
// writes are in ./writes.ts. None of the reads runs in a transaction.

export const getFitnessRouteHeatmapPyramid = async (
  db: Db,
  { actorId }: { actorId: string }
): Promise<FitnessRouteHeatmapPyramid | null> => {
  const row = await readPyramidRow(db, actorId)
  return row ? toFitnessRouteHeatmapPyramid(row) : null
}

export const getFitnessRouteHeatmapTilesByKeys = async (
  db: Db,
  { actorId, tileKeys }: { actorId: string; tileKeys: string[] }
): Promise<FitnessRouteHeatmapTileRow[]> => {
  const uniqueKeys = [...new Set(tileKeys)]
  if (uniqueKeys.length === 0) return []

  // One binding is spent on actorId, so the chunk reserves it.
  const rows = await selectInChunks(
    db,
    uniqueKeys,
    (chunk) =>
      db
        .selectFrom('fitness_route_heatmap_tiles')
        .selectAll()
        .where('actorId', '=', actorId)
        .where('tileKey', 'in', chunk)
        .execute(),
    1
  )
  return rows.map(toFitnessRouteHeatmapTileRow)
}

export const getFitnessRouteHeatmapTilesInRange = async (
  db: Db,
  params: FitnessRouteHeatmapTileRangeParams
): Promise<FitnessRouteHeatmapTileRow[]> => {
  const rows = await applyTileRange(
    db.selectFrom('fitness_route_heatmap_tiles').selectAll(),
    params
  ).execute()
  return rows.map(toFitnessRouteHeatmapTileRow)
}

export const sumFitnessRouteHeatmapTilePoints = async (
  db: Db,
  params: FitnessRouteHeatmapTileRangeParams
): Promise<number> => {
  const row = await applyTileRange(
    db
      .selectFrom('fitness_route_heatmap_tiles')
      .select((eb) =>
        eb.fn.sum<number | string | null>('pointCount').as('total')
      ),
    params
  ).executeTakeFirst()

  return Number(row?.total ?? 0)
}

/**
 * The tile count and point sum of one build. One aggregate over the
 * `(actorId, version)` index.
 */
export const getFitnessRouteHeatmapTileTotals = async (
  db: Db,
  { actorId, version }: { actorId: string; version: number }
): Promise<{ tileCount: number; pointCount: number }> => {
  const row = await db
    .selectFrom('fitness_route_heatmap_tiles')
    .select((eb) => [
      eb.fn.countAll<number | string>().as('tiles'),
      eb.fn.sum<number | string | null>('pointCount').as('points')
    ])
    .where('actorId', '=', actorId)
    .where('version', '=', version)
    .executeTakeFirst()

  return {
    tileCount: Number(row?.tiles ?? 0),
    pointCount: Number(row?.points ?? 0)
  }
}

export const fitnessRouteHeatmapTileQueries = {
  getFitnessRouteHeatmapPyramid,
  claimFitnessRouteHeatmapPyramidBuild,
  getFitnessRouteHeatmapTilesByKeys,
  getFitnessRouteHeatmapTilesInRange,
  sumFitnessRouteHeatmapTilePoints,
  getFitnessRouteHeatmapTileTotals,
  ...fitnessRouteHeatmapTileWrites
}
