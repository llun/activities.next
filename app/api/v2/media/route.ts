import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { handleSyncMediaUpload } from '@/lib/services/medias/handleSyncMediaUpload'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// POST /api/v2/media — Mastodon requires the `write:media` scope (we also accept
// the coarser `write`). Uploads are processed synchronously by `saveMedia`
// (LocalFile/S3 store the file and return a fully-populated MediaAttachment), so
// we always return 200. Mastodon's 202 path applies only when processing is
// deferred; the deferred flow here is the separate presigned-upload service,
// which is out of scope for this route.
export const POST = traceApiRoute(
  'uploadMediaV2',
  OAuthGuardAnyScope(
    [Scope.enum.write, Scope.enum['write:media']],
    (req, context) => handleSyncMediaUpload(req, context, CORS_HEADERS),
    { errorResponse: corsErrorResponse(CORS_HEADERS) }
  )
)
