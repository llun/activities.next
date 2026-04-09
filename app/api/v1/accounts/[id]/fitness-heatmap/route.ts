import { NextRequest } from 'next/server'
import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { deserializeRegions, serializeRegions } from '@/lib/fitness/regions'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { AppRouterParams } from '@/lib/services/guards/types'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  ERROR_400,
  ERROR_401,
  ERROR_403,
  ERROR_404,
  ERROR_500,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

const FitnessHeatmapQueryParams = z.object({
  activity_type: z.string().optional(),
  period_type: z.enum(['all_time', 'yearly', 'monthly']),
  period_key: z.string(),
  /** Comma-separated region IDs, e.g. "netherlands,singapore". Omit for world-wide. */
  region: z.string().optional()
})

export const GET = traceApiRoute(
  'getAccountFitnessHeatmap',
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
    const id = idToUrl(encodedAccountId)

    if (currentActor.id !== id) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_403,
        responseStatusCode: 403
      })
    }

    const url = new URL(req.url)
    const queryParams = Object.fromEntries(url.searchParams.entries())
    const parsed = FitnessHeatmapQueryParams.safeParse(queryParams)
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

    // Normalize: parse IDs through deserializeRegions to drop unknown/empty
    // entries, then re-serialize so the DB key is always canonical
    // (sorted, deduped, lowercase). Unknown IDs silently map to world-wide ('').
    const region = rawRegion
      ? serializeRegions(deserializeRegions(rawRegion))
      : ''

    const heatmap = await database.getFitnessHeatmapByKey({
      actorId: id,
      activityType: activityType ?? null,
      periodType,
      periodKey,
      region
    })

    if (!heatmap) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })
    }

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: {
        id: heatmap.id,
        activityType: heatmap.activityType,
        periodType: heatmap.periodType,
        periodKey: heatmap.periodKey,
        region: heatmap.region,
        status: heatmap.status,
        imagePath: heatmap.imagePath,
        activityCount: heatmap.activityCount
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
