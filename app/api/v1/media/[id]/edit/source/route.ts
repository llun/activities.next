import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import {
  ERROR_RECORD_NOT_FOUND,
  getMediaEditSource
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
}

// GET /api/v1/media/:id/edit/source — the bytes of the photo as it was
// uploaded (the edit's `original` file, else the live one), served from this
// origin so the editor's canvas is never tainted by a CDN or S3 origin. Owner
// only, so the response may be cached only by the owner's own browser.
export const GET = traceApiRoute(
  'getMediaEditSource',
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
      const result = id
        ? await getMediaEditSource({
            database,
            mediaId: id,
            accountId: account.id
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

      // The type is sniffed from the bytes: `medias.original.mimeType` names
      // the uploaded file, not the stored encoding.
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
