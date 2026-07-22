import { revokeStatusQuoteFromUserInput } from '@/lib/actions/revokeStatusQuote'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_403,
  ERROR_500,
  apiCorsError,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
  quoting_status_id: string
}

// POST /api/v1/statuses/:id/quotes/:quoting_status_id/revoke — the quoted
// author withdraws approval of a quote of their status. 403 unless the caller
// owns the quoted status; 404 when no quote edge links the two ids.
export const POST = traceApiRoute(
  'revokeStatusQuote',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:statuses']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const { id, quoting_status_id: quotingStatusIdParam } = await params
      if (!id || !quotingStatusIdParam) {
        return apiCorsError(req, CORS_HEADERS, 404)
      }
      const quotedStatusId = idToUrl(id)
      const quotingStatusId = idToUrl(quotingStatusIdParam)

      const result = await revokeStatusQuoteFromUserInput({
        currentActor,
        quotedStatusId,
        quotingStatusId,
        database
      })
      if (!result.ok) {
        if (result.reason === 'forbidden') {
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: ERROR_403,
            responseStatusCode: 403
          })
        }
        return apiCorsError(req, CORS_HEADERS, 404)
      }

      const mastodonStatus = await getMastodonStatus(
        database,
        result.status,
        currentActor.id
      )
      if (!mastodonStatus) {
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
        data: mastodonStatus
      })
    }
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return {
        statusId: params?.id || 'unknown',
        quotingStatusId: params?.quoting_status_id || 'unknown'
      }
    }
  }
)
