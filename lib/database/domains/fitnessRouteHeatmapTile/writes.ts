import { newPyramidRow } from '@/lib/database/domains/fitnessRouteHeatmapTile/rows'
import type {
  UpdateFitnessRouteHeatmapPyramidParams,
  UpsertFitnessRouteHeatmapTilesParams
} from '@/lib/database/domains/fitnessRouteHeatmapTile/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import { insertInChunks } from '@/lib/database/kysely/inList'

// The route heatmap pyramid writes other than the claim (./claim.ts). The
// progress write is one statement; the tile upsert, the stale-tile sweep and
// the per-actor delete each run their ownership check or row lock and their
// writes in one transaction.

export const updateFitnessRouteHeatmapPyramid = async (
  db: Db,
  {
    actorId,
    pyramidId,
    claimSeq,
    status,
    error,
    cursor,
    totalCount,
    scannedCount,
    activityCount,
    tileCount,
    pointCount,
    completedAt
  }: UpdateFitnessRouteHeatmapPyramidParams
): Promise<boolean> => {
  const result = await db
    .updateTable('fitness_route_heatmap_pyramids')
    .set({
      updatedAt: new Date(),
      ...(status !== undefined ? { status } : {}),
      ...(error !== undefined ? { error } : {}),
      ...(totalCount !== undefined ? { totalCount } : {}),
      ...(scannedCount !== undefined ? { scannedCount } : {}),
      ...(activityCount !== undefined ? { activityCount } : {}),
      ...(tileCount !== undefined ? { tileCount } : {}),
      ...(pointCount !== undefined ? { pointCount } : {}),
      ...(completedAt !== undefined
        ? { completedAt: completedAt === null ? null : new Date(completedAt) }
        : {}),
      ...(cursor !== undefined
        ? {
            cursorCreatedAt:
              cursor === null ? null : new Date(cursor.createdAt),
            cursorId: cursor === null ? null : cursor.id
          }
        : {})
    })
    .where('actorId', '=', actorId)
    .where('id', '=', pyramidId)
    .where('claimSeq', '=', claimSeq)
    .executeTakeFirst()

  return Number(result.numUpdatedRows) > 0
}

export const upsertFitnessRouteHeatmapTiles = async (
  db: Db,
  {
    actorId,
    pyramidId,
    claimSeq,
    version,
    tiles,
    progress
  }: UpsertFitnessRouteHeatmapTilesParams
): Promise<boolean> => {
  const currentTime = new Date()
  const rows = tiles.map((tile) => ({
    actorId,
    tileKey: tile.tileKey,
    z: tile.z,
    x: tile.x,
    y: tile.y,
    version,
    segments: tile.segments,
    pointCount: tile.pointCount,
    createdAt: currentTime,
    updatedAt: currentTime
  }))

  return inTransaction(db, async (trx) => {
    // Guarded heartbeat, and the fence. An UPDATE rather than a SELECT
    // because it takes the pyramid row's write lock for the rest of the
    // transaction, so a concurrent claim's compare-and-swap blocks here
    // instead of landing between the ownership check and the tile writes.
    const stillOwned = await trx
      .updateTable('fitness_route_heatmap_pyramids')
      .set({
        updatedAt: currentTime,
        ...(progress
          ? {
              scannedCount: progress.scannedCount,
              ...(progress.activityCount !== undefined
                ? { activityCount: progress.activityCount }
                : {}),
              ...(progress.totalCount !== undefined
                ? { totalCount: progress.totalCount }
                : {}),
              ...(progress.cursor
                ? {
                    cursorCreatedAt: new Date(progress.cursor.createdAt),
                    cursorId: progress.cursor.id
                  }
                : {})
            }
          : {})
      })
      .where('actorId', '=', actorId)
      .where('id', '=', pyramidId)
      .where('claimSeq', '=', claimSeq)
      .executeTakeFirst()

    if (Number(stillOwned.numUpdatedRows) === 0) return false
    if (rows.length === 0) return true

    await insertInChunks(trx, rows, (chunk) =>
      trx
        .insertInto('fitness_route_heatmap_tiles')
        .values(chunk)
        .onConflict((oc) =>
          oc.columns(['actorId', 'tileKey']).doUpdateSet((eb) => ({
            version: eb.ref('excluded.version'),
            segments: eb.ref('excluded.segments'),
            pointCount: eb.ref('excluded.pointCount'),
            updatedAt: eb.ref('excluded.updatedAt')
          }))
        )
        .execute()
    )

    return true
  })
}

export const deleteStaleFitnessRouteHeatmapTiles = async (
  db: Db,
  {
    actorId,
    pyramidId,
    claimSeq,
    beforeVersion
  }: {
    actorId: string
    pyramidId: string
    claimSeq: number
    beforeVersion: number
  }
): Promise<number> =>
  inTransaction(db, async (trx) => {
    // The guarded UPDATE first, exactly as the tile upsert does it: it is
    // both the ownership check and the row lock that serialises this sweep
    // against a concurrent claim or clear, instead of leaving a window
    // between checking and deleting.
    const stillOwned = await trx
      .updateTable('fitness_route_heatmap_pyramids')
      .set({ updatedAt: new Date() })
      .where('actorId', '=', actorId)
      .where('id', '=', pyramidId)
      .where('claimSeq', '=', claimSeq)
      .executeTakeFirst()

    if (Number(stillOwned.numUpdatedRows) === 0) return 0

    const deletedTiles = await trx
      .deleteFrom('fitness_route_heatmap_tiles')
      .where('actorId', '=', actorId)
      .where('version', '<', beforeVersion)
      .executeTakeFirst()
    return Number(deletedTiles.numDeletedRows)
  })

export const deleteFitnessRouteHeatmapPyramidAndTilesForActor = async (
  db: Db,
  { actorId }: { actorId: string }
): Promise<number> =>
  inTransaction(db, async (trx) => {
    // Insert-then-delete, deliberately. Deleting the pyramid row is what
    // fences a build already running — the token every tile write is checked
    // against goes with it — and holding that row's lock for the rest of the
    // transaction is what stops a claim landing between this and the tile
    // delete below. But a DELETE matching NO row takes no lock at all, so
    // when the actor has never built (or already cleared), a claim runs
    // straight through the gap, flushes tiles, and has them deleted out from
    // under it — finishing as `completed` over tiles that no longer exist.
    // Making the row exist first gives the delete something to lock in that
    // case too, so a concurrent claim's own insert waits for this commit and
    // starts cleanly afterwards.
    await trx
      .insertInto('fitness_route_heatmap_pyramids')
      .values(newPyramidRow(actorId, new Date(), new Date()))
      .onConflict((oc) => oc.column('actorId').doNothing())
      .execute()
    await trx
      .deleteFrom('fitness_route_heatmap_pyramids')
      .where('actorId', '=', actorId)
      .execute()
    const deletedTiles = await trx
      .deleteFrom('fitness_route_heatmap_tiles')
      .where('actorId', '=', actorId)
      .executeTakeFirst()
    return Number(deletedTiles.numDeletedRows)
  })

export const fitnessRouteHeatmapTileWrites = {
  updateFitnessRouteHeatmapPyramid,
  upsertFitnessRouteHeatmapTiles,
  deleteStaleFitnessRouteHeatmapTiles,
  deleteFitnessRouteHeatmapPyramidAndTilesForActor
}
