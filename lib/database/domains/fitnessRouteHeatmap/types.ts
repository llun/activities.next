// Parameter types and the `FitnessRouteHeatmapDatabase` interface of the
// route heatmap domain. The parsed `FitnessRouteHeatmap` types live in
// lib/types/database/fitnessRouteHeatmap.ts; the stored row types are the
// generated `FitnessRouteHeatmaps` and `FitnessRouteHeatmapRegionNames` table
// types in lib/database/kysely/db.ts.
import type {
  FitnessRouteHeatmap,
  FitnessRouteHeatmapBounds,
  FitnessRouteHeatmapPeriodType,
  FitnessRouteHeatmapRegionName,
  FitnessRouteHeatmapSegment,
  FitnessRouteHeatmapStatus,
  FitnessRouteHeatmapSummary
} from '@/lib/types/database/fitnessRouteHeatmap'

export interface CreateFitnessRouteHeatmapParams {
  actorId: string
  activityType?: string | null
  periodType: FitnessRouteHeatmapPeriodType
  periodKey: string
  region?: string
  periodStart?: Date | null
  periodEnd?: Date | null
}

export interface GetFitnessRouteHeatmapParams {
  id: string
}

export interface GetFitnessRouteHeatmapByKeyParams {
  actorId: string
  activityType?: string | null
  periodType: FitnessRouteHeatmapPeriodType
  periodKey: string
  region?: string
  includeDeleted?: boolean
}

export interface GetFitnessRouteHeatmapsForActorParams {
  actorId: string
  activityType?: string | null
  periodType?: FitnessRouteHeatmapPeriodType
  region?: string
}

export interface UpdateFitnessRouteHeatmapStatusParams {
  id: string
  status: FitnessRouteHeatmapStatus
  bounds?: FitnessRouteHeatmapBounds | null
  segments?: FitnessRouteHeatmapSegment[] | null
  error?: string | null
  activityCount?: number
  pointCount?: number
  totalCount?: number
  cursorOffset?: number
  isPartial?: boolean
  clearDeleted?: boolean
  clearDeletedBefore?: number
  /**
   * When true, skip the write if the row has since been cancelled. A worker uses
   * this for its mid-run checkpoint/complete/fail writes so a user cancel that
   * lands while a pass is executing is not silently overwritten (the row stays
   * `cancelled` and the update reports `false`).
   */
  abortIfCancelled?: boolean
}

export interface GetDistinctActivityTypesParams {
  actorId: string
}

export interface FitnessRouteHeatmapDatabase {
  createFitnessRouteHeatmap(
    params: CreateFitnessRouteHeatmapParams
  ): Promise<FitnessRouteHeatmap>
  getFitnessRouteHeatmap(
    params: GetFitnessRouteHeatmapParams
  ): Promise<FitnessRouteHeatmap | null>
  getFitnessRouteHeatmapByKey(
    params: GetFitnessRouteHeatmapByKeyParams
  ): Promise<FitnessRouteHeatmap | null>
  /**
   * Resolves a heatmap by its opt-in public share token. The public, no-auth
   * embed surface uses this — only shared, not-deleted heatmaps resolve.
   */
  getFitnessRouteHeatmapByShareToken(params: {
    shareToken: string
  }): Promise<FitnessRouteHeatmap | null>
  /**
   * The same lookup without the payload blobs, for a caller that needs only the
   * share's identity and scope.
   *
   * The tile routes are exactly that caller: they answer from the pyramid and
   * read this row only for its actor, status, region and variant. Reading the
   * full row there would drag the entire untiled heatmap off disk and through
   * `JSON.parse` on every tile batch — megabytes to use none of them, on a
   * public route a viewport hits many times per pan.
   */
  getFitnessRouteHeatmapSummaryByShareToken(params: {
    shareToken: string
  }): Promise<FitnessRouteHeatmapSummary | null>
  /**
   * Sets the public share token on a heatmap owned by `actorId` (scoped to the
   * actor so a caller can only share their own heatmaps). Returns true when a
   * matching, not-already-deleted row was updated.
   */
  setFitnessRouteHeatmapShareToken(params: {
    actorId: string
    id: string
    shareToken: string
  }): Promise<boolean>
  /**
   * Clears (revokes) the public share token on a heatmap owned by `actorId`.
   * Returns true when a matching, not-already-deleted row was updated.
   */
  clearFitnessRouteHeatmapShareToken(params: {
    actorId: string
    id: string
  }): Promise<boolean>
  /**
   * The rows a pyramid build is generating on behalf of: every in-flight
   * (`pending`/`generating`) heatmap of the actor's whose scope the one
   * per-actor pyramid covers — all activity types, all time — whatever region
   * each is scoped to, because a region is a view over that shared pyramid
   * rather than geometry of its own.
   *
   * A build reads this to know whether anyone is still waiting (all
   * subscribers cancelled means it can stop) and, on completion, which rows to
   * finish.
   */
  getFitnessRouteHeatmapSubscribers(params: {
    actorId: string
  }): Promise<FitnessRouteHeatmapSummary[]>
  /**
   * Copies a pyramid build's progress onto those same subscriber rows, so the
   * existing per-heatmap progress UI keeps reporting against a build that is no
   * longer per-heatmap. `cursorOffset` carries the count of activities scanned
   * so far — the pyramid's own resume position is a keyset cursor that this
   * column cannot express, and does not need to.
   *
   * Returns how many rows were updated. Terminal and deleted rows are left
   * alone: a run that was cancelled mid-build must not be dragged back to
   * `generating` by a worker that has not noticed yet.
   */
  mirrorFitnessRouteHeatmapGenerationProgress(params: {
    actorId: string
    totalCount: number
    cursorOffset: number
  }): Promise<number>
  getFitnessRouteHeatmapsForActor(
    params: GetFitnessRouteHeatmapsForActorParams
  ): Promise<FitnessRouteHeatmap[]>
  getFitnessRouteHeatmapSummariesForActor(
    params: GetFitnessRouteHeatmapsForActorParams
  ): Promise<FitnessRouteHeatmapSummary[]>
  updateFitnessRouteHeatmapStatus(
    params: UpdateFitnessRouteHeatmapStatusParams
  ): Promise<boolean>
  /**
   * Soft-deletes a single route heatmap owned by `actorId`. Returns true when a
   * matching, not-already-deleted row was removed. Scoped to the actor so a
   * caller can only remove their own heatmaps.
   */
  deleteFitnessRouteHeatmap(params: {
    actorId: string
    id: string
  }): Promise<boolean>
  /**
   * Cancels an in-flight (`pending`/`generating`) route-heatmap run owned by
   * `actorId`, moving it to a terminal `cancelled` state and resetting the run
   * fields so a later Generate/Retry starts clean. No-op (returns false) on a
   * terminal or deleted row. Resetting `cursorOffset` to 0 invalidates a
   * continuation that was already queued before the cancel (its requested cursor
   * no longer matches), and while the row stays `cancelled` an orphaned worker
   * pass can't revive it either, because that worker's checkpoint/complete/fail
   * writes pass `abortIfCancelled` and skip a cancelled row.
   *
   * Note: if the user immediately re-generates, a fresh run reclaims the row
   * (back to `generating`) — at which point an orphaned pass from the cancelled
   * run races the new one exactly as a retry-against-a-`generating`-row already
   * would. Fully fencing two concurrent runs on one row would need a per-run
   * token and is out of scope here.
   */
  cancelFitnessRouteHeatmapGeneration(params: {
    actorId: string
    id: string
  }): Promise<boolean>
  getDistinctActivityTypesForActor(
    params: GetDistinctActivityTypesParams
  ): Promise<string[]>
  getDistinctRouteHeatmapRegionsForActor(params: {
    actorId: string
    includeDeleted?: boolean
  }): Promise<string[]>
  /**
   * Returns every saved region label for the actor as `{ region, name }` pairs,
   * keyed by the serialized region cache key. Used to rehydrate region names in
   * the heatmaps UI so a rediscovered region keeps its label.
   */
  getFitnessRouteHeatmapRegionNames(params: {
    actorId: string
  }): Promise<FitnessRouteHeatmapRegionName[]>
  /**
   * Upserts the label for one `(actorId, region)` region. A null/blank name
   * clears the stored label (deletes the row). The world-wide region (empty
   * `region` key) is unnamed and never stored.
   */
  setFitnessRouteHeatmapRegionName(params: {
    actorId: string
    region: string
    name: string | null
  }): Promise<void>
  deleteFitnessRouteHeatmapsForActor(params: {
    actorId: string
  }): Promise<number>
}
