import { z } from 'zod'

import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { resolveStatusIdParam } from '@/lib/services/mastodon/resolveClientId'
import { refetchedStatusResponse } from '@/lib/services/mastodon/statusActionResponse'
import { getReadableStatusForAction } from '@/lib/services/statuses/getReadableStatusForAction'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_422,
  apiCorsError,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.PUT]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// The guard's 401/403 carry the CORS headers too, so a cross-origin client
// can read them.
const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

interface Params {
  id: string
}

const BodySchema = z.object({
  folder_id: z.string().min(1).max(255).nullable()
})

// PUT /api/v1/statuses/:id/bookmark_folder — files the status into one of the
// viewer's own bookmark folders (`folder_id`), or unfiles it (`null`). A
// status that is not bookmarked yet is bookmarked first, so one call does
// both. Answers the status, whose `bookmark_folder_id` shows the new folder.
// An Activities.next extension: never federated, no notification.
export const PUT = traceApiRoute(
  'fileBookmarkStatus',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:bookmarks']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const encodedStatusId = (await params).id
      if (!encodedStatusId) return apiCorsError(req, CORS_HEADERS, 404)

      const parsed = BodySchema.safeParse(
        // JSON only: a form body cannot say null.
        await req.json().catch(() => undefined)
      )
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }

      const statusId = await resolveStatusIdParam(database, encodedStatusId)
      const status = await getReadableStatusForAction({
        database,
        statusId,
        currentActor,
        withReplies: false
      })
      if (!status) return apiCorsError(req, CORS_HEADERS, 404)

      const result = await database.fileBookmark({
        actorId: currentActor.id,
        statusId: status.id,
        folderId: parsed.data.folder_id
      })
      if (result === 'folder-not-found') {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'Bookmark folder not found' },
          responseStatusCode: 404
        })
      }
      if (result === 'status-not-found') {
        return apiCorsError(req, CORS_HEADERS, 404)
      }

      return refetchedStatusResponse({
        req,
        database,
        currentActor,
        statusId: status.id,
        allowedMethods: CORS_HEADERS
      })
    },
    guardOptions
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { statusId: params?.id || 'unknown' }
    }
  }
)
