import { resolveCollectionItem } from '@/lib/services/collections/resolveCollectionItem'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_404, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.DELETE]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
  item_id: string
}

// Remove a single membership addressed by its CollectionItem id (Mastodon 4.6
// `DELETE /api/v1/collections/:id/items/:item_id`). Owner-only; the removal is
// owner-scoped in the database layer, so a non-owner (or unknown item) answers
// 404 without leaking existence. The account-id fallback also works here as an
// extension, mirroring approve/revoke.
export const DELETE = traceApiRoute(
  'removeCollectionItem',
  OAuthGuard<Params>(
    [Scope.enum['write:collections']],
    async (req, { database, currentActor, params }) => {
      const { id, item_id } = await params
      const item = await resolveCollectionItem(database, id, item_id)
      const removed = item
        ? await database.removeCollectionItemById({
            id,
            actorId: currentActor.id,
            itemId: item.id
          })
        : false
      if (!removed) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
    }
  )
)
