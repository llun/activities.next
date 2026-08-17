import crypto from 'crypto'
import { Knex } from 'knex'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  chunkArray,
  getInsertBatchSize,
  getWhereInBatchSize
} from '@/lib/database/sql/utils/knex'
import {
  FitnessRouteHeatmapPyramid,
  FitnessRouteHeatmapPyramidClaim,
  FitnessRouteHeatmapPyramidCursor,
  FitnessRouteHeatmapPyramidStatus,
  FitnessRouteHeatmapTileRow,
  SQLFitnessRouteHeatmapPyramid,
  SQLFitnessRouteHeatmapTile
} from '@/lib/types/database/fitnessRouteHeatmapTile'

export interface ClaimFitnessRouteHeatmapPyramidBuildParams {
  actorId: string
  /**
   * When the generation was asked for. A pyramid that completed at or after
   * this moment already answers the request, so the caller skips the rebuild
   * entirely — which is what makes N queued region generations cost one build
   * plus N cheap completions.
   */
  requestedAt: number
  /**
   * A build whose heartbeat is older than this is treated as abandoned and may
   * be taken over. Callers set it well beyond the checkpoint interval, so only
   * a worker that really died is reclaimed.
   */
  staleBefore: number
}

export interface UpdateFitnessRouteHeatmapPyramidParams {
  actorId: string
  /**
   * The build version the caller believes it owns. Every write is guarded on
   * it, so a pass that was superseded — by a fresh claim, or by a reclaim after
   * it was presumed dead — silently writes nothing instead of corrupting the
   * new build's progress.
   */
  version: number
  status?: FitnessRouteHeatmapPyramidStatus
  error?: string | null
  cursor?: FitnessRouteHeatmapPyramidCursor | null
  totalCount?: number
  scannedCount?: number
  activityCount?: number
  tileCount?: number
  pointCount?: number
  completedAt?: number | null
}

export interface UpsertFitnessRouteHeatmapTilesParams {
  actorId: string
  version: number
  tiles: Array<{
    tileKey: string
    z: number
    x: number
    y: number
    segments: string
    pointCount: number
  }>
}

export interface FitnessRouteHeatmapTileRangeParams {
  actorId: string
  z: number
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export interface FitnessRouteHeatmapTileDatabase {
  getFitnessRouteHeatmapPyramid(params: {
    actorId: string
  }): Promise<FitnessRouteHeatmapPyramid | null>
  /**
   * Takes ownership of an actor's pyramid build, creating the row on first use.
   *
   * Ownership is decided by a compare-and-swap on `version`: the row is read,
   * then updated only if its version has not moved since. A caller that loses
   * that race is told so rather than proceeding to write tiles the winner would
   * have to reconcile. See `FitnessRouteHeatmapPyramidClaimReason` for the
   * outcomes.
   */
  claimFitnessRouteHeatmapPyramidBuild(
    params: ClaimFitnessRouteHeatmapPyramidBuildParams
  ): Promise<FitnessRouteHeatmapPyramidClaim>
  /**
   * Applies a progress, cursor or terminal-status write, guarded on the build
   * version. Returns false when the guard rejected it, which is the signal that
   * this pass no longer owns the build and should stop.
   *
   * Every call also refreshes `updatedAt`, so a running build heartbeats simply
   * by checkpointing — there is no separate keepalive to forget.
   */
  updateFitnessRouteHeatmapPyramid(
    params: UpdateFitnessRouteHeatmapPyramidParams
  ): Promise<boolean>
  getFitnessRouteHeatmapTilesByKeys(params: {
    actorId: string
    tileKeys: string[]
  }): Promise<FitnessRouteHeatmapTileRow[]>
  getFitnessRouteHeatmapTilesInRange(
    params: FitnessRouteHeatmapTileRangeParams
  ): Promise<FitnessRouteHeatmapTileRow[]>
  /**
   * Writes a flush of merged tiles, stamping each with the build version. The
   * caller has already merged them against whatever was stored, so this
   * overwrites rather than accumulates.
   */
  upsertFitnessRouteHeatmapTiles(
    params: UpsertFitnessRouteHeatmapTilesParams
  ): Promise<void>
  sumFitnessRouteHeatmapTilePoints(
    params: FitnessRouteHeatmapTileRangeParams
  ): Promise<number>
  /**
   * Drops tiles left behind by an earlier build. Running this when a build
   * completes is how activities deleted since the last one disappear, with no
   * per-activity bookkeeping and no decrementing of visit counts.
   */
  deleteStaleFitnessRouteHeatmapTiles(params: {
    actorId: string
    beforeVersion: number
  }): Promise<number>
  deleteFitnessRouteHeatmapTilesForActor(params: {
    actorId: string
  }): Promise<number>
  deleteFitnessRouteHeatmapPyramidForActor(params: {
    actorId: string
  }): Promise<number>
}

const parseSQLFitnessRouteHeatmapPyramid = (
  row: SQLFitnessRouteHeatmapPyramid
): FitnessRouteHeatmapPyramid => ({
  id: row.id,
  actorId: row.actorId,
  status: row.status as FitnessRouteHeatmapPyramidStatus,
  error: row.error ?? undefined,
  version: Number(row.version ?? 0),
  totalCount: Number(row.totalCount ?? 0),
  scannedCount: Number(row.scannedCount ?? 0),
  activityCount: Number(row.activityCount ?? 0),
  tileCount: Number(row.tileCount ?? 0),
  pointCount: Number(row.pointCount ?? 0),
  // Both halves or neither: a cursor missing its id cannot resume a keyset
  // scan, so it is no cursor at all.
  cursor:
    row.cursorCreatedAt && row.cursorId
      ? {
          createdAt: getCompatibleTime(row.cursorCreatedAt),
          id: row.cursorId
        }
      : undefined,
  completedAt: row.completedAt ? getCompatibleTime(row.completedAt) : undefined,
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt)
})

const parseSQLFitnessRouteHeatmapTile = (
  row: SQLFitnessRouteHeatmapTile
): FitnessRouteHeatmapTileRow => ({
  actorId: row.actorId,
  tileKey: row.tileKey,
  z: Number(row.z),
  x: Number(row.x),
  y: Number(row.y),
  version: Number(row.version ?? 0),
  segments: row.segments ?? '',
  pointCount: Number(row.pointCount ?? 0),
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt)
})

const readPyramidRow = async (database: Knex, actorId: string) => {
  const row = await database<SQLFitnessRouteHeatmapPyramid>(
    'fitness_route_heatmap_pyramids'
  )
    .where('actorId', actorId)
    .first()
  return row ?? null
}

const applyTileRange = (
  database: Knex,
  { actorId, z, minX, maxX, minY, maxY }: FitnessRouteHeatmapTileRangeParams
) =>
  database('fitness_route_heatmap_tiles')
    .where('actorId', actorId)
    .where('z', z)
    .whereBetween('x', [minX, maxX])
    .whereBetween('y', [minY, maxY])

export const FitnessRouteHeatmapTileSQLDatabaseMixin = (
  database: Knex
): FitnessRouteHeatmapTileDatabase => ({
  async getFitnessRouteHeatmapPyramid({ actorId }: { actorId: string }) {
    const row = await readPyramidRow(database, actorId)
    return row ? parseSQLFitnessRouteHeatmapPyramid(row) : null
  },

  async claimFitnessRouteHeatmapPyramidBuild({
    actorId,
    requestedAt,
    staleBefore
  }: ClaimFitnessRouteHeatmapPyramidBuildParams) {
    const currentTime = new Date()

    // Create the row on first use. `ignore` rather than `merge` so two
    // concurrent first-time claims do not reset each other's state; whichever
    // insert lost simply reads the winner's row below.
    await database('fitness_route_heatmap_pyramids')
      .insert({
        id: crypto.randomUUID(),
        actorId,
        status: 'idle',
        error: null,
        version: 0,
        totalCount: 0,
        scannedCount: 0,
        activityCount: 0,
        tileCount: 0,
        pointCount: 0,
        cursorCreatedAt: null,
        cursorId: null,
        completedAt: null,
        createdAt: currentTime,
        updatedAt: currentTime
      })
      .onConflict('actorId')
      .ignore()

    const existing = await readPyramidRow(database, actorId)
    // The insert above guarantees a row; this only narrows the type.
    if (!existing) {
      throw new Error(
        `Failed to create route heatmap pyramid row for actor ${actorId}`
      )
    }

    const pyramid = parseSQLFitnessRouteHeatmapPyramid(existing)

    if (
      pyramid.status === 'completed' &&
      pyramid.completedAt !== undefined &&
      pyramid.completedAt >= requestedAt
    ) {
      return {
        claimed: false,
        resumed: false,
        reason: 'already-fresh' as const,
        pyramid
      }
    }

    if (pyramid.status === 'generating' && pyramid.updatedAt >= staleBefore) {
      return {
        claimed: false,
        resumed: false,
        reason: 'build-in-progress' as const,
        pyramid
      }
    }

    // Only an abandoned build that got far enough to checkpoint is worth
    // resuming; anything else starts a fresh version so its tiles replace the
    // previous build's rather than adding to them.
    const resumed =
      pyramid.status === 'generating' && pyramid.cursor !== undefined
    const nextVersion = resumed ? pyramid.version : pyramid.version + 1

    const claimedRows = await database('fitness_route_heatmap_pyramids')
      .where('actorId', actorId)
      // The compare-and-swap: if another worker claimed between the read above
      // and this write, the version has moved and this updates nothing.
      .where('version', pyramid.version)
      .update(
        resumed
          ? {
              status: 'generating',
              error: null,
              updatedAt: currentTime
            }
          : {
              status: 'generating',
              error: null,
              version: nextVersion,
              scannedCount: 0,
              activityCount: 0,
              cursorCreatedAt: null,
              cursorId: null,
              completedAt: null,
              updatedAt: currentTime
            }
      )

    if (claimedRows === 0) {
      const current = await readPyramidRow(database, actorId)
      return {
        claimed: false,
        resumed: false,
        reason: 'lost-race' as const,
        pyramid: current ? parseSQLFitnessRouteHeatmapPyramid(current) : pyramid
      }
    }

    const claimed = await readPyramidRow(database, actorId)
    return {
      claimed: true,
      resumed,
      reason: 'claimed' as const,
      pyramid: claimed ? parseSQLFitnessRouteHeatmapPyramid(claimed) : pyramid
    }
  },

  async updateFitnessRouteHeatmapPyramid({
    actorId,
    version,
    status,
    error,
    cursor,
    totalCount,
    scannedCount,
    activityCount,
    tileCount,
    pointCount,
    completedAt
  }: UpdateFitnessRouteHeatmapPyramidParams) {
    const updateData: Record<string, unknown> = { updatedAt: new Date() }

    if (status !== undefined) updateData.status = status
    if (error !== undefined) updateData.error = error
    if (totalCount !== undefined) updateData.totalCount = totalCount
    if (scannedCount !== undefined) updateData.scannedCount = scannedCount
    if (activityCount !== undefined) updateData.activityCount = activityCount
    if (tileCount !== undefined) updateData.tileCount = tileCount
    if (pointCount !== undefined) updateData.pointCount = pointCount
    if (completedAt !== undefined) {
      updateData.completedAt =
        completedAt === null ? null : new Date(completedAt)
    }
    if (cursor !== undefined) {
      updateData.cursorCreatedAt =
        cursor === null ? null : new Date(cursor.createdAt)
      updateData.cursorId = cursor === null ? null : cursor.id
    }

    const updated = await database('fitness_route_heatmap_pyramids')
      .where('actorId', actorId)
      .where('version', version)
      .update(updateData)

    return updated > 0
  },

  async getFitnessRouteHeatmapTilesByKeys({
    actorId,
    tileKeys
  }: {
    actorId: string
    tileKeys: string[]
  }) {
    const uniqueKeys = [...new Set(tileKeys)]
    if (uniqueKeys.length === 0) return []

    const tiles: FitnessRouteHeatmapTileRow[] = []
    // One binding is spent on actorId, so the chunk reserves it.
    for (const chunk of chunkArray(
      uniqueKeys,
      getWhereInBatchSize(database, 1)
    )) {
      const rows = await database<SQLFitnessRouteHeatmapTile>(
        'fitness_route_heatmap_tiles'
      )
        .where('actorId', actorId)
        .whereIn('tileKey', chunk)
        .select('*')
      tiles.push(...rows.map(parseSQLFitnessRouteHeatmapTile))
    }

    return tiles
  },

  async getFitnessRouteHeatmapTilesInRange(
    params: FitnessRouteHeatmapTileRangeParams
  ) {
    const rows = await applyTileRange(database, params).select('*')
    return (rows as SQLFitnessRouteHeatmapTile[]).map(
      parseSQLFitnessRouteHeatmapTile
    )
  },

  async upsertFitnessRouteHeatmapTiles({
    actorId,
    version,
    tiles
  }: UpsertFitnessRouteHeatmapTilesParams) {
    if (tiles.length === 0) return

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

    for (const chunk of chunkArray(
      rows,
      getInsertBatchSize(database, rows[0])
    )) {
      await database('fitness_route_heatmap_tiles')
        .insert(chunk)
        .onConflict(['actorId', 'tileKey'])
        .merge(['version', 'segments', 'pointCount', 'updatedAt'])
    }
  },

  async sumFitnessRouteHeatmapTilePoints(
    params: FitnessRouteHeatmapTileRangeParams
  ) {
    const [row] = await applyTileRange(database, params).sum<
      { total: string | number | null }[]
    >({ total: 'pointCount' })

    return Number(row?.total ?? 0)
  },

  async deleteStaleFitnessRouteHeatmapTiles({
    actorId,
    beforeVersion
  }: {
    actorId: string
    beforeVersion: number
  }) {
    return database('fitness_route_heatmap_tiles')
      .where('actorId', actorId)
      .where('version', '<', beforeVersion)
      .delete()
  },

  async deleteFitnessRouteHeatmapTilesForActor({
    actorId
  }: {
    actorId: string
  }) {
    return database('fitness_route_heatmap_tiles')
      .where('actorId', actorId)
      .delete()
  },

  async deleteFitnessRouteHeatmapPyramidForActor({
    actorId
  }: {
    actorId: string
  }) {
    return database('fitness_route_heatmap_pyramids')
      .where('actorId', actorId)
      .delete()
  }
})
