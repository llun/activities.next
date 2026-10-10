import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import {
  ERROR_RECORD_NOT_FOUND,
  getMediaEditMask
} from '@/lib/services/medias/edit/saveMediaEdit'
import { getServedMediaHeaders } from '@/lib/services/medias/servedMediaHeaders'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_401, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

interface Params {
  id: string
  maskId: string
}

const MASK_ID_PATTERN = /^[a-z0-9]{8}$/

// GET /api/v1/media/:id/edit/masks/:maskId — one stored mask of a photo edit
// (a one-channel PNG in the source photo's shape), for the editor to load.
// Owner only: masks are never federated or part of a public entity, so the
// response may be cached only by the owner's own browser. The editor's URL
// carries `?v=<file id>`, so a mask saved again is a new URL.
export const GET = traceApiRoute(
  'getMediaEditMask',
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

      const { id, maskId } = (await params) ?? {
        id: undefined,
        maskId: undefined
      }
      const result =
        id && maskId && MASK_ID_PATTERN.test(maskId)
          ? await getMediaEditMask({
              database,
              mediaId: id,
              accountId: account.id,
              maskId
            })
          : null
      if (!result) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: ERROR_RECORD_NOT_FOUND },
          responseStatusCode: 404
        })
      }
      if (!result.ok) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: result.body,
          responseStatusCode: result.status
        })
      }

      // The type is sniffed from the bytes (always PNG for a stored mask).
      const headers = getServedMediaHeaders(result.body.mimeType)
      headers.set('Cache-Control', 'private, max-age=300')
      headers.set('Content-Length', String(result.body.buffer.byteLength))
      return new Response(new Uint8Array(result.body.buffer), {
        status: 200,
        headers
      })
    },
    guardOptions
  )
)
