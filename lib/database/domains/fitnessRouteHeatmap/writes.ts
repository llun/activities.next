import crypto from 'crypto'
import type { UpdateObject } from 'kysely'

import {
  getActivityTypeKey,
  pyramidSubscriber
} from '@/lib/database/domains/fitnessRouteHeatmap/rows'
import type {
  CreateFitnessRouteHeatmapParams,
  UpdateFitnessRouteHeatmapStatusParams
} from '@/lib/database/domains/fitnessRouteHeatmap/types'
import type { DB, Db } from '@/lib/database/kysely'
import { timestampValue } from '@/lib/database/kysely/dialect'
import { toEpochMilliseconds } from '@/lib/database/kysely/normalize'
import type { FitnessRouteHeatmap } from '@/lib/types/database/fitnessRouteHeatmap'

// The route heatmap writes. Each is one statement; none runs in a
// transaction.

export const createFitnessRouteHeatmap = async (
  db: Db,
  params: CreateFitnessRouteHeatmapParams
): Promise<FitnessRouteHeatmap> => {
  const currentTime = new Date()
  const id = crypto.randomUUID()

  await db
    .insertInto('fitness_route_heatmaps')
    .values({
      id,
      actorId: params.actorId,
      activityType: params.activityType ?? null,
      activityTypeKey: getActivityTypeKey(params.activityType),
      periodType: params.periodType,
      periodKey: params.periodKey,
      region: params.region ?? '',
      periodStart: params.periodStart ?? null,
      periodEnd: params.periodEnd ?? null,
      bounds: null,
      segments: null,
      status: 'pending',
      error: null,
      activityCount: 0,
      pointCount: 0,
      totalCount: 0,
      cursorOffset: 0,
      isPartial: false,
      shareToken: null,
      createdAt: currentTime,
      updatedAt: currentTime,
      deletedAt: null
    })
    .execute()

  // The values as written, not re-read: the same answer the insert gives. A
  // period bound given as a Date is truthy whatever its time, so an epoch-0
  // one reads back as 0 here.
  const time = currentTime.getTime()
  return {
    id,
    actorId: params.actorId,
    activityType: params.activityType ?? undefined,
    periodType: params.periodType,
    periodKey: params.periodKey,
    region: params.region ?? '',
    periodStart: params.periodStart
      ? (toEpochMilliseconds(params.periodStart) ?? undefined)
      : undefined,
    periodEnd: params.periodEnd
      ? (toEpochMilliseconds(params.periodEnd) ?? undefined)
      : undefined,
    bounds: undefined,
    segments: [],
    status: 'pending',
    error: undefined,
    activityCount: 0,
    pointCount: 0,
    totalCount: 0,
    cursorOffset: 0,
    isPartial: false,
    shareToken: null,
    createdAt: time,
    updatedAt: time,
    deletedAt: undefined
  }
}

export const setFitnessRouteHeatmapShareToken = async (
  db: Db,
  {
    actorId,
    id,
    shareToken
  }: { actorId: string; id: string; shareToken: string }
): Promise<boolean> => {
  // Only assign a token when the row has none yet (`shareToken IS NULL`), so
  // two concurrent share requests don't each write a distinct token (last
  // write wins, leaving the first caller with a stale token). The loser's
  // update affects 0 rows; the caller then re-reads the stored (winner's)
  // token. A row that is already shared keeps its existing token.
  const result = await db
    .updateTable('fitness_route_heatmaps')
    .set({ shareToken, updatedAt: new Date() })
    .where('id', '=', id)
    .where('actorId', '=', actorId)
    .where('deletedAt', 'is', null)
    .where('shareToken', 'is', null)
    .executeTakeFirst()

  return Number(result.numUpdatedRows) > 0
}

export const clearFitnessRouteHeatmapShareToken = async (
  db: Db,
  { actorId, id }: { actorId: string; id: string }
): Promise<boolean> => {
  const result = await db
    .updateTable('fitness_route_heatmaps')
    .set({ shareToken: null, updatedAt: new Date() })
    .where('id', '=', id)
    .where('actorId', '=', actorId)
    .where('deletedAt', 'is', null)
    .executeTakeFirst()

  return Number(result.numUpdatedRows) > 0
}

export const mirrorFitnessRouteHeatmapGenerationProgress = async (
  db: Db,
  {
    actorId,
    totalCount,
    cursorOffset
  }: { actorId: string; totalCount: number; cursorOffset: number }
): Promise<number> => {
  const result = await db
    .updateTable('fitness_route_heatmaps')
    .set({
      status: 'generating',
      totalCount,
      cursorOffset,
      updatedAt: new Date()
    })
    .where(pyramidSubscriber)
    .where('actorId', '=', actorId)
    .executeTakeFirst()

  return Number(result.numUpdatedRows)
}

export const updateFitnessRouteHeatmapStatus = async (
  db: Db,
  {
    id,
    status,
    bounds,
    segments,
    error,
    activityCount,
    pointCount,
    totalCount,
    cursorOffset,
    isPartial,
    clearDeleted,
    clearDeletedBefore,
    abortIfCancelled
  }: UpdateFitnessRouteHeatmapStatusParams
): Promise<boolean> => {
  const result = await db
    .updateTable('fitness_route_heatmaps')
    .set((eb) => {
      const updateData: UpdateObject<DB, 'fitness_route_heatmaps'> = {
        status,
        updatedAt: new Date()
      }

      if (bounds !== undefined) {
        updateData.bounds = bounds === null ? null : JSON.stringify(bounds)
      }
      if (segments !== undefined) {
        updateData.segments =
          segments === null ? null : JSON.stringify(segments)
      }
      if (error !== undefined) {
        updateData.error = error
      }
      if (activityCount !== undefined) {
        updateData.activityCount = activityCount
      }
      if (pointCount !== undefined) {
        updateData.pointCount = pointCount
      }
      if (totalCount !== undefined) {
        updateData.totalCount = totalCount
      }
      if (cursorOffset !== undefined) {
        updateData.cursorOffset = cursorOffset
      }
      if (isPartial !== undefined) {
        updateData.isPartial = isPartial
      }
      if (clearDeleted) {
        // Restoring a soft-deleted row must not resurrect the old share token
        // (rows deleted before deletion cleared the token still carry one).
        // Keep it on a live row, which the job also passes `clearDeleted` for.
        // PostgreSQL and SQLite evaluate every SET expression against the
        // row as it was before the update, so the CASE reads the old
        // `deletedAt` although `deletedAt` is cleared in the same statement.
        updateData.shareToken = eb
          .case()
          .when('deletedAt', 'is', null)
          .then(eb.ref('shareToken'))
          .else(eb.lit(null))
          .end()
        updateData.deletedAt = null
      }
      return updateData
    })
    .where('id', '=', id)
    .$if(!clearDeleted, (qb) => qb.where('deletedAt', 'is', null))
    .$if(Boolean(clearDeleted), (qb) =>
      qb.where((eb) =>
        eb.or([
          eb('deletedAt', 'is', null),
          eb('deletedAt', '<=', timestampValue(clearDeletedBefore ?? 0))
        ])
      )
    )
    // A cancel that landed mid-run must win: never resurrect a cancelled row.
    .$if(Boolean(abortIfCancelled), (qb) =>
      qb.where('status', '<>', 'cancelled')
    )
    .executeTakeFirst()

  return Number(result.numUpdatedRows) > 0
}

export const setFitnessRouteHeatmapRegionName = async (
  db: Db,
  {
    actorId,
    region,
    name
  }: { actorId: string; region: string; name: string | null }
): Promise<void> => {
  const trimmed = name?.trim() ?? ''
  // A blank name clears the label. The world-wide region (empty key) is never
  // named, so there is nothing to store for it either.
  if (trimmed === '' || region === '') {
    await db
      .deleteFrom('fitness_route_heatmap_region_names')
      .where('actorId', '=', actorId)
      .where('region', '=', region)
      .execute()
    return
  }

  const currentTime = new Date()
  await db
    .insertInto('fitness_route_heatmap_region_names')
    .values({
      actorId,
      region,
      name: trimmed,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    .onConflict((conflict) =>
      conflict
        .columns(['actorId', 'region'])
        .doUpdateSet({ name: trimmed, updatedAt: currentTime })
    )
    .execute()
}

export const deleteFitnessRouteHeatmapsForActor = async (
  db: Db,
  { actorId }: { actorId: string }
): Promise<number> => {
  const result = await db
    .updateTable('fitness_route_heatmaps')
    .set({
      deletedAt: new Date(),
      // A share token is a bearer capability to the GPS heatmap. Deleting the
      // heatmap revokes it: the soft-deleted row is later restored in place
      // by regeneration, and a surviving token would silently re-expose the
      // fresh heatmap to anyone who kept the old URL.
      shareToken: null,
      updatedAt: new Date()
    })
    .where('actorId', '=', actorId)
    .where('deletedAt', 'is', null)
    .executeTakeFirst()

  return Number(result.numUpdatedRows)
}

export const deleteFitnessRouteHeatmap = async (
  db: Db,
  { actorId, id }: { actorId: string; id: string }
): Promise<boolean> => {
  const result = await db
    .updateTable('fitness_route_heatmaps')
    .set({
      deletedAt: new Date(),
      // See deleteFitnessRouteHeatmapsForActor: deletion revokes the share.
      shareToken: null,
      updatedAt: new Date()
    })
    .where('id', '=', id)
    .where('actorId', '=', actorId)
    .where('deletedAt', 'is', null)
    .executeTakeFirst()

  return Number(result.numUpdatedRows) > 0
}

export const cancelFitnessRouteHeatmapGeneration = async (
  db: Db,
  { actorId, id }: { actorId: string; id: string }
): Promise<boolean> => {
  const result = await db
    .updateTable('fitness_route_heatmaps')
    .set({
      status: 'cancelled',
      error: null,
      bounds: null,
      segments: null,
      activityCount: 0,
      pointCount: 0,
      cursorOffset: 0,
      isPartial: false,
      updatedAt: new Date()
    })
    .where('id', '=', id)
    .where('actorId', '=', actorId)
    .where('deletedAt', 'is', null)
    .where('status', 'in', ['pending', 'generating'])
    .executeTakeFirst()

  return Number(result.numUpdatedRows) > 0
}

export const fitnessRouteHeatmapWrites = {
  createFitnessRouteHeatmap,
  setFitnessRouteHeatmapShareToken,
  clearFitnessRouteHeatmapShareToken,
  mirrorFitnessRouteHeatmapGenerationProgress,
  updateFitnessRouteHeatmapStatus,
  deleteFitnessRouteHeatmap,
  cancelFitnessRouteHeatmapGeneration,
  setFitnessRouteHeatmapRegionName,
  deleteFitnessRouteHeatmapsForActor
}
