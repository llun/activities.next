import {
  OAuthGuard,
  OAuthGuardAnyScope
} from '@/lib/services/guards/OAuthGuard'
import { getMastodonFilterStatus } from '@/lib/services/mastodon/getMastodonFilter'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  HTTP_STATUS,
  apiErrorResponse,
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

export const GET = traceApiRoute(
  'getFilterStatus',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.read, Scope.enum['read:filters']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const status = await database.getFilterStatus({
        actorId: currentActor.id,
        id
      })
      if (!status) return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: getMastodonFilterStatus(status)
      })
    }
  )
)

export const DELETE = traceApiRoute(
  'deleteFilterStatus',
  OAuthGuard<Params>(
    [Scope.enum['write:filters']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const status = await database.deleteFilterStatus({
        actorId: currentActor.id,
        id
      })
      if (!status) return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
    }
  )
)
