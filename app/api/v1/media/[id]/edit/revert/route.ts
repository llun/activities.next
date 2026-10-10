import { z } from 'zod'

import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import {
  ERROR_RECORD_NOT_FOUND,
  revertMediaEdit
} from '@/lib/services/medias/edit/saveMediaEdit'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_401, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

interface Params {
  id: string
}

const RevertEditRequest = z.object({
  base_version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  save_id: z.string().uuid(),
  apply_to_posts: z.enum(['update', 'gallery']).optional()
})

// POST /api/v1/media/:id/edit/revert — puts the uploaded file back as the
// photo's live file and forgets the recipe. JSON body: `base_version`,
// `save_id` and, when the photo is in posts, `apply_to_posts`.
export const POST = traceApiRoute(
  'revertMediaEdit',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:media']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const account = currentActor.account
      if (!account) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_401,
          responseStatusCode: 401
        })
      }

      const { id } = (await params) ?? { id: undefined }
      if (!id) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: ERROR_RECORD_NOT_FOUND },
          responseStatusCode: 404
        })
      }

      let body: unknown = null
      try {
        body = await req.json()
      } catch {
        // Answered below as invalid input.
      }
      const parsed = RevertEditRequest.safeParse(body)
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'Invalid input' },
          responseStatusCode: 422
        })
      }

      const result = await revertMediaEdit({
        database,
        accountId: account.id,
        mediaId: id,
        host: headerHost(req.headers),
        baseVersion: parsed.data.base_version,
        saveId: parsed.data.save_id,
        applyToPosts: parsed.data.apply_to_posts
      })
      return result.ok
        ? apiResponse({ req, allowedMethods: CORS_HEADERS, data: result.body })
        : apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: result.body,
            responseStatusCode: result.status
          })
    },
    guardOptions
  )
)
