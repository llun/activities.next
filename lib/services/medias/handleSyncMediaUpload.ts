import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { saveMedia } from '@/lib/services/medias'
import { MediaValidationError } from '@/lib/services/medias/errors'
import { MediaSchema } from '@/lib/services/medias/types'
import { Actor } from '@/lib/types/domain/actor'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import { ERROR_422, ERROR_500, apiResponse } from '@/lib/utils/response'

// Shared handler for the two synchronous upload endpoints (POST /api/v1/media
// and POST /api/v2/media). Both accept the same params (file, thumbnail,
// description, focus) and, because `saveMedia` is synchronous in every storage
// driver here, both return 200 with a fully-populated MediaAttachment (there is
// no async/202 path — that only exists in the separate presigned flow). The
// only per-route difference is the trace name and CORS allow-list, which stay
// at the route level.
export const handleSyncMediaUpload = async (
  req: NextRequest,
  context: { database: Database; currentActor: Actor },
  corsHeaders: HttpMethod[]
) => {
  const { database, currentActor } = context

  // A malformed multipart body is a client error (422), so parse it separately
  // from the upload work below — only genuine processing failures map to 500.
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return apiResponse({
      req,
      allowedMethods: corsHeaders,
      data: ERROR_422,
      responseStatusCode: 422
    })
  }

  const media = MediaSchema.safeParse(Object.fromEntries(form.entries()))
  if (!media.success) {
    return apiResponse({
      req,
      allowedMethods: corsHeaders,
      data: ERROR_422,
      responseStatusCode: 422
    })
  }

  try {
    const response = await saveMedia(database, currentActor, media.data)
    if (!response) {
      return apiResponse({
        req,
        allowedMethods: corsHeaders,
        data: ERROR_422,
        responseStatusCode: 422
      })
    }
    return apiResponse({
      req,
      allowedMethods: corsHeaders,
      data: response
    })
  } catch (e) {
    // Client-actionable failures (quota exceeded, unsupported/invalid media)
    // are 422 (Mastodon's "Validation failed"); only genuine internal/processing
    // faults are 500.
    if (e instanceof MediaValidationError) {
      return apiResponse({
        req,
        allowedMethods: corsHeaders,
        data: ERROR_422,
        responseStatusCode: 422
      })
    }
    const nodeErr = e as NodeJS.ErrnoException
    logger.error(nodeErr)
    return apiResponse({
      req,
      allowedMethods: corsHeaders,
      data: ERROR_500,
      responseStatusCode: 500
    })
  }
}
