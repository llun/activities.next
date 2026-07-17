import { z } from 'zod'

import { updateStatusInteractionPolicyFromUserInput } from '@/lib/actions/updateStatusInteractionPolicy'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { parseStatusRequestBody } from '@/lib/services/statuses/parseStatusRequestBody'
import { Scope } from '@/lib/types/database/operations'
import { QuoteApprovalPolicy } from '@/lib/types/domain/status'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_403,
  ERROR_422,
  ERROR_500,
  apiCorsError,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.PUT]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

const BodySchema = z.object({
  quote_approval_policy: QuoteApprovalPolicy
})

// PUT /api/v1/statuses/:id/interaction_policy — the author sets who may quote
// this status. Rewrites the content-blob policy without recording an edit (so
// edited_at never flips) and re-federates the note so its advertised
// interactionPolicy.canQuote refreshes.
export const PUT = traceApiRoute(
  'updateStatusInteractionPolicy',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:statuses']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const encodedStatusId = (await params).id
      if (!encodedStatusId) return apiCorsError(req, CORS_HEADERS, 404)
      const statusId = idToUrl(encodedStatusId)

      let parsed: z.infer<typeof BodySchema>
      try {
        const result = BodySchema.safeParse(await parseStatusRequestBody(req))
        if (!result.success) {
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: ERROR_422,
            responseStatusCode: 422
          })
        }
        parsed = result.data
      } catch {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }

      const updatedStatus = await updateStatusInteractionPolicyFromUserInput({
        statusId,
        currentActor,
        quoteApprovalPolicy: parsed.quote_approval_policy,
        database
      })
      // null = not found, not owned, or not a Note/Poll — author-only.
      if (!updatedStatus) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_403,
          responseStatusCode: 403
        })
      }

      const mastodonStatus = await getMastodonStatus(
        database,
        updatedStatus,
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
      return { statusId: params?.id || 'unknown' }
    }
  }
)
