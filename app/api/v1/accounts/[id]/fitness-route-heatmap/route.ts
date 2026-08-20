import { NextRequest } from 'next/server'
import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { normalizeRegionParam } from '@/lib/fitness/regions'
import { GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME } from '@/lib/jobs/names'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import {
  HeatmapTileSource,
  buildHeatmapTileSource,
  isPyramidVariantHeatmap
} from '@/lib/services/fitness-files/heatmapTiles/tileSource'
import { hasSameOriginProof } from '@/lib/services/guards/sameOriginProof'
import { AppRouterParams } from '@/lib/services/guards/types'
import { resolveActorIdParam } from '@/lib/services/mastodon/resolveClientId'
import { getQueue } from '@/lib/services/queue'
import { FitnessRouteHeatmap } from '@/lib/types/database/fitnessRouteHeatmap'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_400,
  ERROR_401,
  ERROR_403,
  ERROR_500,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST,
  HttpMethod.enum.DELETE
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

const OptionalActivityType = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim() || undefined : value),
  z.string().optional()
)

const FitnessRouteHeatmapQueryParams = z.object({
  activity_type: OptionalActivityType,
  period_type: z.enum(['all_time', 'yearly', 'monthly']),
  period_key: z.string(),
  // Bound the raw input to guard against unbounded payloads, but allow more than
  // the 255-char cache-key column: clients may send high-precision coordinates
  // that normalizeRegionParam rounds (to 2 dp) and caps (to MAX_HEATMAP_REGIONS) well
  // under 255 before anything is stored.
  region: z.string().max(1024).optional()
})

const FitnessRouteHeatmapTriggerBody = z.object({
  activity_type: OptionalActivityType,
  period_type: z.enum(['all_time', 'yearly', 'monthly']),
  period_key: z.string(),
  // See FitnessRouteHeatmapQueryParams.region: looser raw cap; normalizeRegionParam
  // rounds + caps the stored value under the 255-char column.
  region: z.string().max(1024).optional(),
  retry: z.boolean().optional(),
  // Stop an in-flight (pending/generating) run instead of enqueuing one.
  cancel: z.boolean().optional()
})

const serializeRouteHeatmap = (
  heatmap: FitnessRouteHeatmap,
  tileSource: HeatmapTileSource | null
) => ({
  id: heatmap.id,
  activityType: heatmap.activityType,
  periodType: heatmap.periodType,
  periodKey: heatmap.periodKey,
  region: heatmap.region,
  status: heatmap.status,
  bounds: heatmap.bounds ?? null,
  segments: heatmap.segments,
  activityCount: heatmap.activityCount,
  pointCount: heatmap.pointCount,
  totalCount: heatmap.totalCount,
  cursorOffset: heatmap.cursorOffset,
  isPartial: heatmap.isPartial,
  shareToken: heatmap.shareToken ?? null,
  error: heatmap.error ?? null,
  tileSource,
  createdAt: heatmap.createdAt,
  updatedAt: heatmap.updatedAt
})

export const GET = traceApiRoute(
  'getAccountFitnessRouteHeatmap',
  async (req: NextRequest, params: AppRouterParams<Params>) => {
    const database = getDatabase()
    if (!database) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }

    const session = await getServerAuthSession()
    if (!session?.user?.email) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_401,
        responseStatusCode: 401
      })
    }

    const currentActor = await getActorFromSession(database, session)
    if (!currentActor) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_401,
        responseStatusCode: 401
      })
    }

    const { id: encodedAccountId } = await params.params
    if (!encodedAccountId) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }
    const id = await resolveActorIdParam(database, encodedAccountId)

    if (currentActor.id !== id) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_403,
        responseStatusCode: 403
      })
    }

    const url = new URL(req.url)
    const parsed = FitnessRouteHeatmapQueryParams.safeParse(
      Object.fromEntries(url.searchParams.entries())
    )
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }

    const {
      activity_type: activityType,
      period_type: periodType,
      period_key: periodKey,
      region: rawRegion
    } = parsed.data

    const heatmap = await database.getFitnessRouteHeatmapByKey({
      actorId: id,
      activityType: activityType ?? null,
      periodType,
      periodKey,
      region: normalizeRegionParam(rawRegion)
    })

    if (!heatmap) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { heatmap: null }
      })
    }

    // Only the all-activities/all-time row can be tile-backed, so the pyramid
    // is read only for that one — every other row would pay an extra query to
    // be told null.
    //
    // Best-effort, like the same read on both public pages: tile work must
    // never cost the user the heatmap they can actually see. Letting this throw
    // would trade the whole untiled response for a table nothing renders yet,
    // which is the one trade the pyramid's own rules forbid.
    const pyramid = isPyramidVariantHeatmap(heatmap)
      ? await database
          .getFitnessRouteHeatmapPyramid({ actorId: id })
          .catch(() => null)
      : null

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: {
        heatmap: serializeRouteHeatmap(
          heatmap,
          buildHeatmapTileSource(heatmap, pyramid)
        )
      }
    })
  },
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { accountId: params?.id || 'unknown' }
    }
  }
)

export const POST = traceApiRoute(
  'triggerFitnessRouteHeatmap',
  async (req: NextRequest, params: AppRouterParams<Params>) => {
    const requestedAt = Date.now()
    const database = getDatabase()
    if (!database) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }

    const session = await getServerAuthSession()
    if (!session?.user?.email) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_401,
        responseStatusCode: 401
      })
    }

    // Manually authenticated cookie-session mutation: apply the same CSRF
    // same-origin proof as AuthenticatedGuard.
    if (!hasSameOriginProof(req)) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_403,
        responseStatusCode: 403
      })
    }

    const currentActor = await getActorFromSession(database, session)
    if (!currentActor) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_401,
        responseStatusCode: 401
      })
    }

    const { id: encodedAccountId } = await params.params
    if (!encodedAccountId) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }
    const id = await resolveActorIdParam(database, encodedAccountId)

    if (currentActor.id !== id) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_403,
        responseStatusCode: 403
      })
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }

    const parsed = FitnessRouteHeatmapTriggerBody.safeParse(body)
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }

    const {
      activity_type: activityType,
      period_type: periodType,
      period_key: periodKey,
      region: rawRegion,
      retry,
      cancel
    } = parsed.data
    const region = normalizeRegionParam(rawRegion)
    const existing = await database.getFitnessRouteHeatmapByKey({
      actorId: id,
      activityType: activityType ?? null,
      periodType,
      periodKey,
      region,
      includeDeleted: true
    })

    // Cancel stops an in-flight run rather than enqueuing one. The DB method is
    // scoped to the actor and only acts on a non-deleted pending/generating row.
    if (cancel === true) {
      const cancelled =
        existing !== null && !existing.deletedAt
          ? await database.cancelFitnessRouteHeatmapGeneration({
              actorId: id,
              id: existing.id
            })
          : false
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { cancelled }
      })
    }

    const shouldResume =
      existing !== null &&
      !existing.deletedAt &&
      existing.cursorOffset > 0 &&
      (existing.status === 'failed' ||
        (existing.status === 'completed' && existing.isPartial))
    const shouldUseRetryId =
      retry === true &&
      existing !== null &&
      !existing.deletedAt &&
      !shouldResume &&
      (existing.status === 'failed' ||
        existing.status === 'generating' ||
        existing.status === 'cancelled')
    const baseJobId =
      id +
      ':route-heatmap:' +
      (activityType ?? 'all') +
      ':' +
      periodType +
      ':' +
      periodKey +
      ':' +
      region
    const jobId = getHashFromString(
      shouldResume
        ? `${baseJobId}:resume:${existing.id}:${existing.cursorOffset}`
        : shouldUseRetryId
          ? `${baseJobId}:retry:${existing.id}:${crypto.randomUUID()}`
          : existing?.deletedAt
            ? `${baseJobId}:restore:${existing.id}:${existing.deletedAt}`
            : baseJobId
    )

    try {
      await getQueue().publish({
        id: jobId,
        name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
        data: {
          actorId: id,
          activityType: activityType ?? null,
          periodType,
          periodKey,
          region,
          requestedAt,
          ...(shouldResume
            ? { resume: true, cursorOffset: existing.cursorOffset }
            : {})
        }
      })
    } catch {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: { queued: true },
      responseStatusCode: 202
    })
  },
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { accountId: params?.id || 'unknown' }
    }
  }
)

export const DELETE = traceApiRoute(
  'deleteAccountFitnessRouteHeatmap',
  async (req: NextRequest, params: AppRouterParams<Params>) => {
    const database = getDatabase()
    if (!database) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }

    const session = await getServerAuthSession()
    if (!session?.user?.email) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_401,
        responseStatusCode: 401
      })
    }

    // Manually authenticated cookie-session mutation: apply the same CSRF
    // same-origin proof as AuthenticatedGuard.
    if (!hasSameOriginProof(req)) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_403,
        responseStatusCode: 403
      })
    }

    const currentActor = await getActorFromSession(database, session)
    if (!currentActor) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_401,
        responseStatusCode: 401
      })
    }

    const { id: encodedAccountId } = await params.params
    if (!encodedAccountId) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }
    const id = await resolveActorIdParam(database, encodedAccountId)

    if (currentActor.id !== id) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_403,
        responseStatusCode: 403
      })
    }

    const url = new URL(req.url)
    const parsed = FitnessRouteHeatmapQueryParams.safeParse(
      Object.fromEntries(url.searchParams.entries())
    )
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }

    const {
      activity_type: activityType,
      period_type: periodType,
      period_key: periodKey,
      region: rawRegion
    } = parsed.data

    const existing = await database.getFitnessRouteHeatmapByKey({
      actorId: id,
      activityType: activityType ?? null,
      periodType,
      periodKey,
      region: normalizeRegionParam(rawRegion)
    })

    if (!existing) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { deleted: false }
      })
    }

    const deleted = await database.deleteFitnessRouteHeatmap({
      actorId: id,
      id: existing.id
    })

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: { deleted }
    })
  },
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { accountId: params?.id || 'unknown' }
    }
  }
)
