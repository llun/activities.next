// Parameter types and the `FitnessRouteHeatmapTileDatabase` interface of the
// route heatmap pyramid domain: the per-actor build row and its tiles. The
// parsed `FitnessRouteHeatmapPyramid` and `FitnessRouteHeatmapTileRow` types
// live in lib/types/database/fitnessRouteHeatmapTile.ts; the stored row types
// are the generated `FitnessRouteHeatmapPyramids` and
// `FitnessRouteHeatmapTiles` table types in lib/database/kysely/db.ts.
import type {
  FitnessRouteHeatmapPyramid,
  FitnessRouteHeatmapPyramidClaim,
  FitnessRouteHeatmapPyramidCursor,
  FitnessRouteHeatmapPyramidStatus,
  FitnessRouteHeatmapTileRow
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
