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
   * The ownership token this pass was handed by its claim
   * (`pyramid.claimSeq`). Every write is guarded on it, so a pass that was
   * superseded — by a fresh claim, or by a reclaim after it was presumed dead
   * — silently writes nothing instead of corrupting its successor's progress.
   *
   * Guarded on the claim token and not on `version` because a resumed build
   * deliberately keeps its version, which would leave exactly the
   * reclaim-after-presumed-dead case unfenced.
   */
  claimSeq: number
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
  /**
   * The ownership token this pass claimed with. The write is rejected outright
   * if the build has since been taken over — without it, a pass that was
   * presumed dead and superseded could still overwrite the tiles its successor
   * had already merged, and on a RESUMED build it would stamp them with the
   * very version the successor is using, so the completion sweep could never
   * remove them.
   */
  claimSeq: number
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
   * Ownership is decided by a compare-and-swap on `claimSeq`: the row is read,
   * then updated only if that token has not moved since, and the update bumps
   * it. A caller that loses the race is told so rather than proceeding to write
   * tiles the winner would have to reconcile. See
   * `FitnessRouteHeatmapPyramidClaimReason` for the outcomes.
   *
   * The token is separate from `version` because the two answer different
   * questions and a resume needs them to diverge: it must keep its version, so
   * that completion's stale sweep spares the tiles the interrupted pass already
   * wrote, which leaves version unable to also mark the change of owner.
   */
  claimFitnessRouteHeatmapPyramidBuild(
    params: ClaimFitnessRouteHeatmapPyramidBuildParams
  ): Promise<FitnessRouteHeatmapPyramidClaim>
  /**
   * Applies a progress, cursor or terminal-status write, guarded on the
   * claim token. Returns false when the guard rejected it, which is the signal
   * that this pass no longer owns the build and should stop.
   *
   * Every call also refreshes `updatedAt`, so a running build heartbeats simply
   * by checkpointing — there is no separate keepalive to forget.
   */
  updateFitnessRouteHeatmapPyramid(
    params: UpdateFitnessRouteHeatmapPyramidParams
  ): Promise<boolean>
  /**
   * Reads the named tiles, at WHATEVER version each was last written at. A
   * fresh (version-bumped) build must therefore check the version it gets back
   * before merging, or it will fold the previous build's counts into its own;
   * a resumed build, which keeps its version, is the case where merging them is
   * the point.
   */
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
   * overwrites rather than accumulates — which is exactly why it is fenced on
   * `claimSeq`.
   *
   * Returns false when this pass no longer owns the build, having written
   * nothing. The check and the writes share one transaction, and the check is
   * a guarded UPDATE rather than a SELECT so it takes the pyramid row's write
   * lock: a claim cannot slip in between them. That heartbeat also doubles as
   * proof of life, so flushing tiles is itself what keeps a working pass from
   * being reclaimed as stale.
   */
  upsertFitnessRouteHeatmapTiles(
    params: UpsertFitnessRouteHeatmapTilesParams
  ): Promise<boolean>
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
  /**
   * Drops an actor's whole pyramid — the build row and every tile — as one
   * unit. Returns the tiles removed.
   *
   * Not two calls, in either order, because each order leaves a window. Tiles
   * first lets a build still running write more of them before the row goes,
   * and those carry a version a recreated pyramid's sweep can never reach.
   * Row first closes that, but on its own opens the mirror image: a build can
   * claim the freshly-absent row, flush legitimately, and have the second
   * statement delete exactly what it just wrote — leaving a pyramid that
   * reports itself complete over tiles that are gone. One transaction is what
   * makes the pair atomic against a claim — and see the implementation for why
   * a row the actor never had still has to be created before it is deleted.
   */
  deleteFitnessRouteHeatmapPyramidAndTilesForActor(params: {
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
  claimSeq: Number(row.claimSeq ?? 0),
  totalCount: Number(row.totalCount ?? 0),
  scannedCount: Number(row.scannedCount ?? 0),
  activityCount: Number(row.activityCount ?? 0),
  tileCount: Number(row.tileCount ?? 0),
  pointCount: Number(row.pointCount ?? 0),
  // Both halves or neither: a cursor missing its id cannot resume a keyset
  // scan, so it is no cursor at all.
  //
  // Tested for null rather than for truthiness, and `applyResumePremiseFilter`
  // asks SQL the same question, because the two must agree exactly — a state
  // one of them calls resumable and the other does not is a row whose claim can
  // never match, wedging the actor's pyramid for good. Truthiness disagreed on
  // two counts: an epoch-0 `cursorCreatedAt` is a falsy integer on SQLite but a
  // truthy Date on PostgreSQL, so the same row read differently per backend,
  // and an empty `cursorId` is falsy in JS while `IS NULL` in SQL is false.
  cursor:
    row.cursorCreatedAt !== null &&
    row.cursorCreatedAt !== undefined &&
    row.cursorId !== null &&
    row.cursorId !== undefined
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

/**
 * Whether a claim may take this pyramid, and if not, why. Shared by the claim's
 * read (which needs the reason) and mirrored in SQL by `applyClaimableFilter`
 * (which needs the same test to hold at the moment of the write). Keeping one
 * function for the JS side means a rule can only drift from the SQL, not from
 * itself.
 */
const classifyPyramidForClaim = (
  pyramid: FitnessRouteHeatmapPyramid,
  requestedAt: number,
  staleBefore: number
): 'already-fresh' | 'build-in-progress' | 'claimable' => {
  if (
    pyramid.status === 'completed' &&
    pyramid.completedAt !== undefined &&
    pyramid.completedAt >= requestedAt
  ) {
    return 'already-fresh'
  }

  if (pyramid.status === 'generating' && pyramid.updatedAt >= staleBefore) {
    return 'build-in-progress'
  }

  return 'claimable'
}

/**
 * `classifyPyramidForClaim(...) === 'claimable'` as a WHERE clause, so the
 * claim's compare-and-swap asserts the state its decision was made on instead
 * of trusting it to still hold.
 *
 * Written as the De Morgan expansion of "not fresh AND not in progress" rather
 * than two `whereNot` groups, because `completedAt` is nullable: `NOT (status =
 * 'completed' AND completedAt >= ?)` evaluates to NULL — and so excludes the
 * row — for a completed build that never stamped a completion time, which is
 * exactly a row a claim should be free to take over.
 */
const applyClaimableFilter = (
  query: Knex.QueryBuilder,
  requestedAt: number,
  staleBefore: number
) =>
  query
    .where((notFresh) =>
      notFresh
        .whereNot('status', 'completed')
        .orWhereNull('completedAt')
        .orWhere('completedAt', '<', new Date(requestedAt))
    )
    .where((notRunning) =>
      notRunning
        .whereNot('status', 'generating')
        .orWhere('updatedAt', '<', new Date(staleBefore))
    )

/**
 * A rectangular window of one zoom level. `whereBetween` means the caller owns
 * splitting a viewport that wraps the antimeridian: at `minX > maxX` this
 * matches nothing rather than wrapping around, so a Pacific-straddling map
 * would silently come back empty.
 */
/**
 * Re-asserts the premise the claim's `resumed` and `version` decision rests on:
 * a resume needs the row to still be a `generating` build with a cursor to pick
 * up from, and a fresh claim needs it to still NOT be one.
 *
 * Separate from `applyClaimableFilter` because the two answer different
 * questions. That one only rules a state out — not already fresh, not still
 * running — and every terminal status satisfies it equally. This one rules a
 * state IN. Without it an incumbent that wakes in the claim's window and writes
 * its terminal state (`status: 'failed'`, `cursor: null`, guarded on a token it
 * still holds) leaves the compare-and-swap matching on a premise that no longer
 * exists: the winner is told it resumed, keeps the previous build's version,
 * and finds no cursor — so it rescans from the beginning INTO that build's own
 * tiles, doubling every count it revisits, and completion cannot sweep the
 * leftovers because the version never moved.
 *
 * Both cursor columns are tested, exactly as `parseSQLFitnessRouteHeatmapPyramid`
 * does. Checking only `cursorId` made a half-written cursor a state SQL called
 * resumable and JS did not, and neither branch of this filter can then match:
 * the claim answers `lost-race` on every attempt, forever, with no way back
 * because clearing the cursor needs a token nobody holds.
 */
const applyResumePremiseFilter = (
  query: Knex.QueryBuilder,
  resumed: boolean
) =>
  resumed
    ? query
        .where('status', 'generating')
        .whereNotNull('cursorCreatedAt')
        .whereNotNull('cursorId')
    : query.where((notResumable) =>
        notResumable
          .whereNot('status', 'generating')
          .orWhereNull('cursorCreatedAt')
          .orWhereNull('cursorId')
      )

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
        claimSeq: 0,
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
    const verdict = classifyPyramidForClaim(pyramid, requestedAt, staleBefore)

    if (verdict !== 'claimable') {
      return { claimed: false, resumed: false, reason: verdict, pyramid }
    }

    // Only an abandoned build that got far enough to checkpoint is worth
    // resuming; anything else starts a fresh version so its tiles replace the
    // previous build's rather than adding to them.
    const resumed =
      pyramid.status === 'generating' && pyramid.cursor !== undefined
    const nextVersion = resumed ? pyramid.version : pyramid.version + 1
    const nextClaimSeq = pyramid.claimSeq + 1

    const claimedRows = await applyResumePremiseFilter(
      applyClaimableFilter(
        database('fitness_route_heatmap_pyramids').where('actorId', actorId),
        requestedAt,
        staleBefore
      ),
      resumed
    )
      // The compare-and-swap. Guarded on the ownership token, which BOTH
      // branches below move — guarding on `version` would be vacuous for a
      // resume, which leaves the version where it is, so two workers reclaiming
      // the same abandoned build would both be told they own it.
      //
      // The token alone is NOT enough, which is why the same predicate the
      // decision above used is repeated as a WHERE clause. A live owner
      // heartbeats by writing `updatedAt`, and finishes by writing `status` and
      // `completedAt` — none of which move `claimSeq`. So between the read and
      // this statement the owner can invalidate every input to the decision
      // while leaving the token exactly where this CAS expects it: a heartbeat
      // that lands there would let this claim steal a demonstrably live build,
      // and a completion that lands there would let it throw away the very
      // pyramid the request was asking for.
      .where('claimSeq', pyramid.claimSeq)
      .update({
        status: 'generating',
        error: null,
        claimSeq: nextClaimSeq,
        updatedAt: currentTime,
        // A fresh build restarts the tile generation and this run's progress.
        // `totalCount`, `tileCount` and `pointCount` are deliberately left:
        // they describe the tiles still on disk, which stay readable until this
        // build's own numbers replace them at completion.
        ...(resumed
          ? {}
          : {
              version: nextVersion,
              scannedCount: 0,
              activityCount: 0,
              cursorCreatedAt: null,
              cursorId: null,
              completedAt: null
            })
      })

    // Re-read either way. On success it picks up a checkpoint the previous
    // owner committed between this claim's read and its CAS, which a resume
    // needs; on failure it is what says WHY, since the row now holds whatever
    // the winner wrote.
    const current = await readPyramidRow(database, actorId)
    const currentPyramid = current
      ? parseSQLFitnessRouteHeatmapPyramid(current)
      : null

    if (claimedRows === 0) {
      // Re-classify rather than always reporting `lost-race`: losing to a build
      // that COMPLETED is `already-fresh`, and a caller told that serves its
      // request from the finished pyramid instead of giving up. A row that
      // reads as claimable means the state was fine and only the token moved —
      // which is what `lost-race` has always meant.
      const verdictNow = currentPyramid
        ? classifyPyramidForClaim(currentPyramid, requestedAt, staleBefore)
        : 'claimable'

      return {
        claimed: false,
        resumed: false,
        reason:
          verdictNow === 'claimable' ? ('lost-race' as const) : verdictNow,
        pyramid: currentPyramid ?? pyramid
      }
    }

    return {
      claimed: true,
      resumed,
      reason: 'claimed' as const,
      // The token reported is the one this CAS wrote, NOT whatever the re-read
      // found. Another worker can claim in the gap before that read, and
      // adopting its token would hand this pass a `claimSeq` the fence accepts
      // — both passes writing freely, the fence failing open, which is worse
      // than not having one. Reporting our own token instead means a
      // superseded pass is rejected by the first write it attempts.
      pyramid: { ...(currentPyramid ?? pyramid), claimSeq: nextClaimSeq }
    }
  },

  async updateFitnessRouteHeatmapPyramid({
    actorId,
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
      .where('claimSeq', claimSeq)
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
    claimSeq,
    version,
    tiles
  }: UpsertFitnessRouteHeatmapTilesParams) {
    if (tiles.length === 0) return true

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

    return database.transaction(async (trx) => {
      // Guarded heartbeat, and the fence. An UPDATE rather than a SELECT
      // because it takes the pyramid row's write lock for the rest of the
      // transaction, so a concurrent claim's compare-and-swap blocks here
      // instead of landing between the ownership check and the tile writes.
      const stillOwned = await trx('fitness_route_heatmap_pyramids')
        .where('actorId', actorId)
        .where('claimSeq', claimSeq)
        .update({ updatedAt: currentTime })

      if (stillOwned === 0) return false

      for (const chunk of chunkArray(rows, getInsertBatchSize(trx, rows[0]))) {
        await trx('fitness_route_heatmap_tiles')
          .insert(chunk)
          .onConflict(['actorId', 'tileKey'])
          .merge(['version', 'segments', 'pointCount', 'updatedAt'])
      }

      return true
    })
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

  async deleteFitnessRouteHeatmapPyramidAndTilesForActor({
    actorId
  }: {
    actorId: string
  }) {
    return database.transaction<number>(async (trx) => {
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
      await trx('fitness_route_heatmap_pyramids')
        .insert({
          id: crypto.randomUUID(),
          actorId,
          status: 'idle',
          error: null,
          version: 0,
          claimSeq: 0,
          totalCount: 0,
          scannedCount: 0,
          activityCount: 0,
          tileCount: 0,
          pointCount: 0,
          cursorCreatedAt: null,
          cursorId: null,
          completedAt: null,
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .onConflict('actorId')
        .ignore()
      await trx('fitness_route_heatmap_pyramids')
        .where('actorId', actorId)
        .delete()
      const deletedTiles: number = await trx('fitness_route_heatmap_tiles')
        .where('actorId', actorId)
        .delete()
      return deletedTiles
    })
  }
})
