import {
  CORS_HEADERS,
  handleFollowCollectionRequest
} from '@/app/api/v1/accounts/[id]/followCollectionHandler'
import {
  OptionalOAuthGuard,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

// GET /api/v1/accounts/:id/following — see followCollectionHandler.ts for the
// local-vs-remote actor split and the cursor shapes.
export const GET = traceApiRoute(
  'getAccountFollowing',
  OptionalOAuthGuard<Params>(
    [Scope.enum.read, Scope.enum['read:follows']],
    async (req, context) => {
      const { database, currentActor, params } = context
      return handleFollowCollectionRequest({
        req,
        database,
        currentActor,
        encodedAccountId: (await params).id,
        field: 'following'
      })
    },
    { errorResponse: corsErrorResponse(CORS_HEADERS), matchMode: 'any' }
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { accountId: params?.id || 'unknown' }
    }
  }
)
