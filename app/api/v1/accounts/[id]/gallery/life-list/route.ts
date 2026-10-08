import { isOwnerGalleryAudience } from '@/lib/services/gallery/galleryAudience'
import { getGalleryLifeList } from '@/lib/services/gallery/galleryQueries'
import { resolveGalleryAccount } from '@/lib/services/gallery/resolveGalleryAccount'
import {
  OptionalOAuthGuard,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_400,
  ERROR_404,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

// GET /api/v1/accounts/:id/gallery/life-list — the account's life list. Anyone
// but the owner gets a 404 unless the owner made the list public.
export const GET = traceApiRoute(
  'getAccountGalleryLifeList',
  OptionalOAuthGuard<Params>(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req, context) => {
      const { database, currentActor, params } = context

      const { id: encodedAccountId } = await params
      if (!encodedAccountId) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })
      }

      const resolved = await resolveGalleryAccount({
        database,
        encodedAccountId,
        currentActor
      })
      if (!resolved) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }
      const { owner, audience } = resolved

      if (!isOwnerGalleryAudience(audience)) {
        const settings = await database.getGallerySettings({
          actorId: owner.id
        })
        if (!settings.lifeListPublic) {
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: ERROR_404,
            responseStatusCode: 404
          })
        }
      }

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: await getGalleryLifeList({ database, owner, audience })
      })
    },
    // `matchMode: 'any'` because a token may legally hold `read:statuses`
    // alone, and `errorResponse` so the guard's own rejections carry CORS
    // headers (see the sibling account media route).
    {
      errorResponse: corsErrorResponse(CORS_HEADERS),
      matchMode: 'any'
    }
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { accountId: params?.id || 'unknown' }
    }
  }
)
