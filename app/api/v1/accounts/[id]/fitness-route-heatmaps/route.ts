import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { hasSameOriginProof } from '@/lib/services/guards/sameOriginProof'
import { AppRouterParams } from '@/lib/services/guards/types'
import { FitnessRouteHeatmapSummary } from '@/lib/types/database/fitnessRouteHeatmap'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_401,
  ERROR_403,
  ERROR_500,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.DELETE
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

const serializeRouteHeatmapSummary = (heatmap: FitnessRouteHeatmapSummary) => ({
  id: heatmap.id,
  activityType: heatmap.activityType,
  periodType: heatmap.periodType,
  periodKey: heatmap.periodKey,
  region: heatmap.region,
  status: heatmap.status,
  activityCount: heatmap.activityCount,
  pointCount: heatmap.pointCount,
  totalCount: heatmap.totalCount,
  cursorOffset: heatmap.cursorOffset,
  isPartial: heatmap.isPartial,
  error: heatmap.error ?? null,
  createdAt: heatmap.createdAt,
  updatedAt: heatmap.updatedAt
})

export const GET = traceApiRoute(
  'getAccountFitnessRouteHeatmaps',
  async (req, params: AppRouterParams<Params>) => {
    const session = await getServerAuthSession()
    if (!session?.user?.email) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_401,
        responseStatusCode: 401
      })
    }

    const database = getDatabase()
    if (!database) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
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
    const id = idToUrl(encodedAccountId)

    if (currentActor.id !== id) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_403,
        responseStatusCode: 403
      })
    }

    const heatmaps = await database.getFitnessRouteHeatmapSummariesForActor({
      actorId: id
    })

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: {
        heatmaps: heatmaps.map(serializeRouteHeatmapSummary)
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

export const DELETE = traceApiRoute(
  'deleteAccountFitnessRouteHeatmaps',
  async (req, params: AppRouterParams<Params>) => {
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

    const database = getDatabase()
    if (!database) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
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
    const id = idToUrl(encodedAccountId)

    if (currentActor.id !== id) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_403,
        responseStatusCode: 403
      })
    }

    const deleted = await database.deleteFitnessRouteHeatmapsForActor({
      actorId: id
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
