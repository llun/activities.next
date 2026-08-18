import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { hasSameOriginProof } from '@/lib/services/guards/sameOriginProof'
import { AppRouterParams } from '@/lib/services/guards/types'
import { resolveActorIdParam } from '@/lib/services/mastodon/resolveClientId'
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
    const id = await resolveActorIdParam(database, encodedAccountId)

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
    const id = await resolveActorIdParam(database, encodedAccountId)

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

    // The tile pyramid is the same cache in a different shape, so "delete my
    // heatmaps" has to take it too — otherwise an owner who cleared everything
    // would still have their routes sitting in tile rows, and a later build
    // could serve them. Its count is deliberately NOT added to `deleted`: that
    // number is the region rows the caller asked about, and the pyramid is one
    // internal row plus however many tiles the ladder happened to produce.
    //
    // `fitness_file_routes` is deliberately left alone. It is a parse cache of
    // files the owner still has, not heatmap output; clearing it would only buy
    // back the slow download-and-reparse path on the next Generate.
    // One call, because the row and its tiles have to go atomically: either
    // order as two statements leaves a window a concurrent build can write
    // into, and so does an actor who has no pyramid row to lock. See the
    // method's own note.
    await database.deleteFitnessRouteHeatmapPyramidAndTilesForActor({
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
