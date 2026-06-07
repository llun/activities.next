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

// POST /api/v1/media — Mastodon's deprecated synchronous upload. Same parameters
// and `write:media` scope as v2, but it always finishes processing before
// responding, so it only ever returns 200 with a fully-processed
// MediaAttachment (no 202 path). Shares the upload handler with v2 — the only
// difference is the trace name.
export const POST = traceApiRoute(
  'uploadMediaV1',
  OAuthGuardAnyScope(
    [Scope.enum.write, Scope.enum['write:media']],
    (req, context) => handleSyncMediaUpload(req, context, CORS_HEADERS),
    { errorResponse: corsErrorResponse(CORS_HEADERS) }
  )
)
