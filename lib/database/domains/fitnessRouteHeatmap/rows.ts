// Pure helpers for `fitness_route_heatmaps` rows: the row mappers, the summary
// column list, the all-activities key, and the predicates the reads and writes
// share. No database access.
import type { ExpressionBuilder, Selectable } from 'kysely'

import type { DB } from '@/lib/database/kysely'
import type { FitnessRouteHeatmaps } from '@/lib/database/kysely/db'
import type {
  FitnessRouteHeatmap,
  FitnessRouteHeatmapBounds,
  FitnessRouteHeatmapPeriodType,
  FitnessRouteHeatmapSegment,
  FitnessRouteHeatmapStatus,
  FitnessRouteHeatmapSummary
} from '@/lib/types/database/fitnessRouteHeatmap'

export type FitnessRouteHeatmapRow = Selectable<FitnessRouteHeatmaps>

/**
 * Every column of a heatmap row except the two payload blobs, `bounds` and
 * `segments`. A summary read must name them explicitly: `segments` holds the
 * entire heatmap, so selecting it to answer a question about status or
 * progress reads megabytes to use none of them.
 */
export const SUMMARY_COLUMNS = [
  'id',
  'actorId',
  'activityType',
  'activityTypeKey',
  'periodType',
  'periodKey',
  'region',
  'periodStart',
  'periodEnd',
  'status',
  'error',
  'activityCount',
  'pointCount',
  'totalCount',
  'cursorOffset',
  'isPartial',
  'shareToken',
  'createdAt',
  'updatedAt',
  'deletedAt'
] as const

export type FitnessRouteHeatmapSummaryRow = Pick<
  FitnessRouteHeatmapRow,
  (typeof SUMMARY_COLUMNS)[number]
>

export const getActivityTypeKey = (activityType?: string | null) =>
  activityType ?? ''

const parseJsonValue = <T>(
  value: string | null | undefined,
  fallback: T
): T => {
  if (!value) {
    return fallback
  }

  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

/**
 * A summary row as the domain `FitnessRouteHeatmapSummary`. The driver has
 * already read the timestamps as epoch milliseconds and `isPartial` as a
 * boolean, on both backends.
 *
 * `periodStart`, `periodEnd` and `deletedAt` are checked for truthiness, so an
 * epoch-0 value reads as unset.
 */
export const toFitnessRouteHeatmapSummary = (
  row: FitnessRouteHeatmapSummaryRow
): FitnessRouteHeatmapSummary => ({
  id: row.id,
  actorId: row.actorId,
  activityType: row.activityType ?? undefined,
  // Written only from FitnessRouteHeatmapPeriodType and
  // FitnessRouteHeatmapStatus; both columns are plain varchars.
  periodType: row.periodType as FitnessRouteHeatmapPeriodType,
  periodKey: row.periodKey,
  region: row.region,
  periodStart: row.periodStart || undefined,
  periodEnd: row.periodEnd || undefined,
  status: row.status as FitnessRouteHeatmapStatus,
  error: row.error ?? undefined,
  activityCount: row.activityCount,
  pointCount: row.pointCount,
  totalCount: Number(row.totalCount ?? 0),
  cursorOffset: Number(row.cursorOffset ?? 0),
  isPartial: Boolean(row.isPartial),
  shareToken: row.shareToken ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  deletedAt: row.deletedAt || undefined
})

/** A full row, payload included, as the domain `FitnessRouteHeatmap`. */
export const toFitnessRouteHeatmap = (
  row: FitnessRouteHeatmapRow
): FitnessRouteHeatmap => {
  const summary = toFitnessRouteHeatmapSummary(row)
  return {
    id: summary.id,
    actorId: summary.actorId,
    activityType: summary.activityType,
    periodType: summary.periodType,
    periodKey: summary.periodKey,
    region: summary.region,
    periodStart: summary.periodStart,
    periodEnd: summary.periodEnd,
    bounds: parseJsonValue<FitnessRouteHeatmapBounds | undefined>(
      row.bounds,
      undefined
    ),
    segments: parseJsonValue<FitnessRouteHeatmapSegment[]>(row.segments, []),
    status: summary.status,
    error: summary.error,
    activityCount: summary.activityCount,
    pointCount: summary.pointCount,
    totalCount: summary.totalCount,
    cursorOffset: summary.cursorOffset,
    isPartial: summary.isPartial,
    shareToken: summary.shareToken,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    deletedAt: summary.deletedAt
  }
}

type HeatmapExpressionBuilder = ExpressionBuilder<DB, 'fitness_route_heatmaps'>

/**
 * The rows one per-actor pyramid build serves: the in-flight heatmaps whose
 * scope that pyramid covers. `activityTypeKey: ''` is the all-activities key
 * (see `getActivityTypeKey`) and `all_time` the whole-history period; region is
 * deliberately unconstrained, because every region is a clipped view over the
 * same pyramid.
 *
 * Restricted to `pending`/`generating` so neither the "is anyone still
 * waiting?" check nor the progress mirror can revive a row that finished,
 * failed or was cancelled while the build was running.
 */
export const pyramidSubscriber = (eb: HeatmapExpressionBuilder) =>
  eb.and([
    eb('deletedAt', 'is', null),
    eb('activityTypeKey', '=', ''),
    eb('periodType', '=', 'all_time'),
    eb('status', 'in', ['pending', 'generating'])
  ])

/**
 * A share token only resolves for the one scope the heatmap UI can manage:
 * every activity, all time (`activityTypeKey: ''` is the all-activities key, as
 * in `pyramidSubscriber`). The sport and period selectors are gone, so a token
 * minted against a filtered row — which the share API once accepted and still
 * addresses — can no longer be found, and therefore revoked, from the UI.
 * Resolving it anyway would leave a bearer link to route data its owner has no
 * way to take back. Not resolving it is what revokes it for everyone who holds
 * the link; the row, its token and the owner's DELETE stay untouched.
 */
export const allActivitiesAllTimeShare = (eb: HeatmapExpressionBuilder) =>
  eb.and([eb('activityTypeKey', '=', ''), eb('periodType', '=', 'all_time')])
