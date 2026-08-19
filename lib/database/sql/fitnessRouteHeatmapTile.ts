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
  /**
   * The build a continuation was handed when its own earlier pass claimed it,
   * proving this pass is that build's rightful successor rather than a rival.
   *
   * Without it a build could never survive its own checkpoint: flushing is the
   * heartbeat, so the pass that just checkpointed leaves a `generating` row
   * with a fresh `updatedAt`, and the continuation it published a moment later
   * reads that as a live build and declines. Every actor whose scan needs more
   * than one pass would build a single flush of tiles and then orphan the
   * pyramid until the staleness window expired.
   *
   * It names the ROW as well as the token, because `claimSeq` counts from zero
   * per row and clearing an actor's heatmaps deletes the row — so `claimSeq: 1`
   * before a clear and `claimSeq: 1` after it are different builds, and the
   * collision lands on the likeliest value of all. Matching on the token alone
   * let a continuation stranded across a clear evict the live build that had
   * replaced it.
   *
   * It is not a bypass of the fence. The compare-and-swap still guards on
   * `claimSeq`, and this claim still moves it, so a continuation delivered
   * twice has exactly one winner — the duplicate presents a token that has
   * already advanced, finds the winner heartbeating, and is refused.
   *
   * **Presenting a matching token is the ONLY way to resume a build**, because
   * it is the only evidence a caller can offer that it will carry on from where
   * that build left off. Keeping a build's version means adding to its tiles,
   * and a claimer who cannot prove that would fold activities the build already
   * holds — or, worse, complete it over the ones it skipped. A caller without
   * one gets a fresh version instead: a full rebuild that sweeps the old build
   * away, which is merely wasteful where the alternative is silently wrong.
   */
  resumeBuild?: {
    pyramidId: string
    claimSeq: number
  }
}

export interface UpdateFitnessRouteHeatmapPyramidParams {
  actorId: string
  /**
   * The pyramid ROW this pass claimed. Fenced on alongside the token because
   * `claimSeq` counts from zero per row and clearing an actor's heatmaps
   * deletes the row: token 1 before a clear and token 1 after it are different
   * builds, so a pass stranded across a clear would otherwise write its tiles
   * and its progress straight into the replacement build — the same collision
   * `resumeBuild` names the row to avoid on the claim.
   */
  pyramidId: string
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
   * The pyramid ROW this pass claimed. Fenced on alongside the token because
   * `claimSeq` counts from zero per row and clearing an actor's heatmaps
   * deletes the row: token 1 before a clear and token 1 after it are different
   * builds, so a pass stranded across a clear would otherwise write its tiles
   * and its progress straight into the replacement build — the same collision
   * `resumeBuild` names the row to avoid on the claim.
   */
  pyramidId: string
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
  /**
   * How far the build has scanned, written by the SAME guarded statement that
   * writes the tiles rather than by a second call after it.
   *
   * Atomicity here is the whole point. Tile counts accumulate, so a build that
   * writes tiles and then dies before recording that it did will fold those
   * same activities again when it resumes — and nothing downstream can tell an
   * inflated count from an honest one. Landing both in one transaction means
   * the cursor stored here always covers exactly the tiles stored with it, so
   * the resume that reads it back skips precisely the activities already folded
   * and no others.
   */
  progress?: {
    scannedCount: number
    activityCount?: number
    totalCount?: number
    cursor?: FitnessRouteHeatmapPyramidCursor
  }
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
   * Applies a progress, cursor or terminal-status write, guarded on the build
   * row and the claim token. Returns false when the guard rejected it, which is
   * the signal that this pass no longer owns the build and should stop.
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
   *
   * A call with nothing to write is still answered from the guard, never
   * short-circuited to `true`: the return means "you still own this build",
   * and a caller told that without anyone having looked would carry on folding
   * into a build somebody else now owns.
   */
  upsertFitnessRouteHeatmapTiles(
    params: UpsertFitnessRouteHeatmapTilesParams
  ): Promise<boolean>
  sumFitnessRouteHeatmapTilePoints(
    params: FitnessRouteHeatmapTileRangeParams
  ): Promise<number>
  /**
   * What one build has on disk, for the counters a completing build stamps on
   * its pyramid row.
   *
   * Counted from the tiles rather than tallied as they are written, because a
   * tile touched by several flushes is one row and would be counted once per
   * flush — and a build spanning continuations has no single process to tally
   * in. Reads the `(actorId, version)` index, so it is one aggregate per build
   * rather than a scan.
   */
  getFitnessRouteHeatmapTileTotals(params: {
    actorId: string
    version: number
  }): Promise<{ tileCount: number; pointCount: number }>
  /**
   * Drops tiles left behind by an earlier build. Running this when a build
   * completes is how activities deleted since the last one disappear, with no
   * per-activity bookkeeping and no decrementing of visit counts.
   *
   * Fenced on the build row and its token like every other pyramid write, and
   * for the same collision: `claimSeq` counts from zero per row and clearing an
   * actor's heatmaps deletes the row, so a build sweeping at version 2 whose
   * call lands after a clear would delete the REPLACEMENT build's version-1
   * tiles — and that build then stamps itself `completed` over tiles that are
   * gone. Returns 0, having deleted nothing, when the guard rejects.
   */
  deleteStaleFitnessRouteHeatmapTiles(params: {
    actorId: string
    pyramidId: string
    claimSeq: number
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

// Attempts to get the actor's build-state row created and read back before
// giving up. One is not enough: clearing an actor's heatmaps can delete the row
// between the insert and the read, and `ON CONFLICT DO NOTHING` holds no lock
// to stop it. Three makes that pathological rather than merely unlucky.
const PYRAMID_ROW_CREATE_ATTEMPTS = 3

const readPyramidRow = async (database: Knex, actorId: string) => {
  const row = await database<SQLFitnessRouteHeatmapPyramid>(
    'fitness_route_heatmap_pyramids'
  )
    .where('actorId', actorId)
    .first()
  return row ?? null
}

/**
 * Whether the caller is presenting this exact build's current token — the row
 * it was handed AND the sequence value it held. Both halves matter: `claimSeq`
 * counts from zero per row and clearing an actor's heatmaps deletes the row, so
 * the first claim before a clear and the first claim after it both hold token
 * 1, and matching on the sequence alone lets a stranded pass evict the live
 * build that replaced it.
 */
const isOwnContinuation = (
  pyramid: FitnessRouteHeatmapPyramid,
  resumeBuild?: { pyramidId: string; claimSeq: number }
) =>
  resumeBuild !== undefined &&
  resumeBuild.pyramidId === pyramid.id &&
  resumeBuild.claimSeq === pyramid.claimSeq

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
  staleBefore: number,
  resumeBuild?: { pyramidId: string; claimSeq: number }
): 'already-fresh' | 'build-in-progress' | 'claimable' => {
  if (
    pyramid.status === 'completed' &&
    pyramid.completedAt !== undefined &&
    pyramid.completedAt >= requestedAt
  ) {
    return 'already-fresh'
  }

  // A continuation carrying this very build's live token is its own next pass,
  // not a competitor for it, so the liveness test does not apply to it.
  if (
    pyramid.status === 'generating' &&
    pyramid.updatedAt >= staleBefore &&
    !isOwnContinuation(pyramid, resumeBuild)
  ) {
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
  staleBefore: number,
  resumeBuild?: { pyramidId: string; claimSeq: number }
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
        .modify((builder) => {
          if (!resumeBuild) return
          builder.orWhere((ownContinuation) =>
            ownContinuation
              .where('id', resumeBuild.pyramidId)
              .where('claimSeq', resumeBuild.claimSeq)
          )
        })
    )

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
) => {
  if (!resumed) {
    // A fresh claim bumps the version and clears the cursor, which is a valid
    // start from ANY state `applyClaimableFilter` already allowed — so there is
    // no premise here to re-assert. Asserting "not resumable" anyway is what
    // made the statement miss the abandoned `generating` row that still holds a
    // cursor, which is precisely the row a fresh build has to be able to take
    // over: the claim then failed on every attempt forever, with no way to
    // clear the cursor because nobody could own the row.
    return query
  }

  // A resume keeps the build's version and adds to its tiles, so it needs the
  // row to still BE that build: still generating, still holding the cursor it
  // will carry on from. An incumbent that wakes in the claim's window and
  // writes its terminal state moves neither the token nor the version, so
  // without this the winner is told it resumed, finds no cursor, and rescans
  // from the beginning into that build's own tiles — doubling every count it
  // revisits, with no version change for the sweep to catch.
  return query
    .where('status', 'generating')
    .whereNotNull('cursorCreatedAt')
    .whereNotNull('cursorId')
}

/**
 * A rectangular window of one zoom level. `whereBetween` means the caller owns
 * splitting a viewport that wraps the antimeridian: at `minX > maxX` this
 * matches nothing rather than wrapping around, so a Pacific-straddling map
 * would silently come back empty.
 */
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
    staleBefore,
    resumeBuild
  }: ClaimFitnessRouteHeatmapPyramidBuildParams) {
    const currentTime = new Date()

    // Create the row on first use. `ignore` rather than `merge` so two
    // concurrent first-time claims do not reset each other's state; whichever
    // insert lost simply reads the winner's row below.
    //
    // Retried, because the insert does NOT guarantee the read that follows
    // finds a row: clearing an actor's heatmaps deletes it, and that delete can
    // land in between. `ON CONFLICT DO NOTHING` takes no lock on the row it
    // conflicts with, so nothing here holds it still. Re-creating is the right
    // answer rather than an error — the row was cleared, and a claim arriving
    // after a clear should build.
    const createAndReadPyramidRow = async () => {
      const insertRow = () =>
        database('fitness_route_heatmap_pyramids')
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

      for (
        let attempt = 1;
        attempt <= PYRAMID_ROW_CREATE_ATTEMPTS;
        attempt += 1
      ) {
        await insertRow()
        const row = await readPyramidRow(database, actorId)
        if (row) return row
      }
      return null
    }

    const existing = await createAndReadPyramidRow()
    // Only reachable if a clear won every attempt in a row, which means the
    // owner is clearing repeatedly rather than anything being broken. Transient
    // by nature: the caller's next run creates the row uncontended.
    if (!existing) {
      throw new Error(
        `Route heatmap pyramid row for actor ${actorId} was cleared during every claim attempt`
      )
    }

    const pyramid = parseSQLFitnessRouteHeatmapPyramid(existing)
    const verdict = classifyPyramidForClaim(
      pyramid,
      requestedAt,
      staleBefore,
      resumeBuild
    )

    if (verdict !== 'claimable') {
      return { claimed: false, resumed: false, reason: verdict, pyramid }
    }

    // Only this build's own continuation may resume it, and only when it got
    // far enough to checkpoint; anything else starts a fresh version so its
    // tiles replace the previous build's rather than adding to them.
    //
    // The token is what makes the difference, not the caller's say-so. A pass
    // that merely declares itself a resume — which every retry of a failed
    // region row does, carrying that row's offset and no pyramid token — can
    // offer no evidence about which activities it will re-present, so letting
    // it keep the version lets it complete a build over the ones it never
    // folded.
    const resumed =
      isOwnContinuation(pyramid, resumeBuild) &&
      pyramid.status === 'generating' &&
      pyramid.cursor !== undefined
    const nextVersion = resumed ? pyramid.version : pyramid.version + 1
    const nextClaimSeq = pyramid.claimSeq + 1

    // The compare-and-swap and the read that confirms it share one transaction.
    // Separately, a failure after the CAS committed — a pool timeout, a reset
    // connection, a statement timeout on the read — left the row stamped
    // `generating` at a token nobody was holding: the caller saw only a throw,
    // so it never learned it had a build, and every claimant for the next
    // staleness window was refused `build-in-progress` while nothing wrote.
    // Rolling the CAS back means a claim either happens and is reported, or
    // does not happen at all.
    const { claimedRows, currentPyramid } = await database.transaction(
      async (trx) => {
        const rows = await applyResumePremiseFilter(
          applyClaimableFilter(
            trx('fitness_route_heatmap_pyramids').where('actorId', actorId),
            requestedAt,
            staleBefore,
            resumeBuild
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
          .where('id', pyramid.id)
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
        // needs; on failure it is what says WHY, since the row now holds
        // whatever the winner wrote.
        const current = await readPyramidRow(trx, actorId)
        return {
          claimedRows: rows,
          currentPyramid: current
            ? parseSQLFitnessRouteHeatmapPyramid(current)
            : null
        }
      }
    )

    if (claimedRows === 0) {
      // Re-classify rather than always reporting `lost-race`: losing to a build
      // that COMPLETED is `already-fresh`, and a caller told that serves its
      // request from the finished pyramid instead of giving up. A row that
      // reads as claimable means the state was fine and only the token moved —
      // which is what `lost-race` has always meant.
      const verdictNow = currentPyramid
        ? classifyPyramidForClaim(
            currentPyramid,
            requestedAt,
            staleBefore,
            resumeBuild
          )
        : 'claimable'

      return {
        claimed: false,
        resumed: false,
        reason:
          verdictNow === 'claimable' ? ('lost-race' as const) : verdictNow,
        pyramid: currentPyramid ?? pyramid
      }
    }

    // A successful CAS holds the row's write lock for the rest of the
    // transaction, so the read above is this pass's own write and the row it
    // names cannot have been deleted or replaced underneath it. `currentPyramid`
    // is therefore never null here; the check is what makes that fact explicit
    // rather than an unchecked spread.
    if (!currentPyramid) {
      return {
        claimed: false,
        resumed: false,
        reason: 'lost-race' as const,
        pyramid
      }
    }

    return {
      claimed: true,
      resumed,
      reason: 'claimed' as const,
      // The token and version reported are the ones THIS compare-and-swap
      // wrote. They agree with the read above only because that read shares the
      // CAS's transaction: taken from a read outside it, a rival claim landing
      // in between would hand this pass the rival's live token, and the fence
      // every later write is checked against would accept both passes — worse
      // than having no fence at all. The read is still what supplies the cursor
      // and the counters, which a resume needs.
      pyramid: {
        ...currentPyramid,
        version: nextVersion,
        claimSeq: nextClaimSeq
      }
    }
  },

  async updateFitnessRouteHeatmapPyramid({
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
      .where('id', pyramidId)
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
    pyramidId,
    claimSeq,
    version,
    tiles,
    progress
  }: UpsertFitnessRouteHeatmapTilesParams) {
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
        .where('id', pyramidId)
        .where('claimSeq', claimSeq)
        .update({
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

      if (stillOwned === 0) return false
      if (rows.length === 0) return true

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

  async getFitnessRouteHeatmapTileTotals({
    actorId,
    version
  }: {
    actorId: string
    version: number
  }) {
    const [row] = await database('fitness_route_heatmap_tiles')
      .where('actorId', actorId)
      .where('version', version)
      .count<{ tiles: string | number | null }[]>({ tiles: '*' })
      .sum<{ tiles: string | number | null; points: string | number | null }[]>(
        { points: 'pointCount' }
      )

    return {
      tileCount: Number(row?.tiles ?? 0),
      pointCount: Number(row?.points ?? 0)
    }
  },

  async deleteStaleFitnessRouteHeatmapTiles({
    actorId,
    pyramidId,
    claimSeq,
    beforeVersion
  }: {
    actorId: string
    pyramidId: string
    claimSeq: number
    beforeVersion: number
  }) {
    return database.transaction<number>(async (trx) => {
      // The guarded UPDATE first, exactly as the tile upsert does it: it is
      // both the ownership check and the row lock that serialises this sweep
      // against a concurrent claim or clear, instead of leaving a window
      // between checking and deleting.
      const stillOwned = await trx('fitness_route_heatmap_pyramids')
        .where('actorId', actorId)
        .where('id', pyramidId)
        .where('claimSeq', claimSeq)
        .update({ updatedAt: new Date() })

      if (stillOwned === 0) return 0

      const deletedTiles: number = await trx('fitness_route_heatmap_tiles')
        .where('actorId', actorId)
        .where('version', '<', beforeVersion)
        .delete()
      return deletedTiles
    })
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
