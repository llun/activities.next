import { NextRequest } from 'next/server'
import { z } from 'zod'

import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { AuthenticatedApiHandle } from '@/lib/services/guards/types'
import { deleteMediaFile, saveMediaThumbnail } from '@/lib/services/medias'
import { getMediaAttachment } from '@/lib/services/medias/getMediaAttachment'
import { FileSchema, FocusSchema } from '@/lib/services/medias/types'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import {
  ERROR_401,
  ERROR_404,
  ERROR_422,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.PUT,
  HttpMethod.enum.PATCH,
  HttpMethod.enum.DELETE
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

// `description` is stored in a varchar(255) column; cap it to avoid a runtime
// DB error. Empty/whitespace-only (and explicit null) descriptions are
// normalised to null so clients can clear alt text by sending "" or null.
// `focus` is "x,y" (each axis in [-1.0, 1.0]); a malformed value fails parsing
// and yields a 422. Both fields are optional; field-level presence is detected
// from the raw payload so a partial update never clears the field the client
// omitted.
const UpdateMediaRequest = z.object({
  description: z
    .string()
    .max(255)
    .nullable()
    .optional()
    .transform((value) => (value && value.trim() ? value : null)),
  focus: FocusSchema.optional()
})

const readPayload = async (
  req: Request
): Promise<Record<string, unknown> | null> => {
  const contentType = req.headers.get('content-type') ?? ''
  try {
    if (contentType.includes('application/json')) {
      const body = await req.json()
      return body && typeof body === 'object'
        ? (body as Record<string, unknown>)
        : {}
    }
    const form = await req.formData()
    return Object.fromEntries(form.entries())
  } catch {
    return null
  }
}

// Mastodon's MediaController applies `doorkeeper_authorize! :write, :'write:media'`
// to every action, including `show` (media management happens while composing),
// so GET requires write/write:media too.
export const GET = traceApiRoute(
  'getMedia',
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
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      const media = await database.getMediaByIdForAccount({
        mediaId: id,
        accountId: account.id
      })
      if (!media) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: getMediaAttachment(media, headerHost(req.headers))
      })
    }
  )
)

// PUT and PATCH both map to Mastodon's `update` action (Rails `resources :media`
// exposes both verbs); they share one handler. write/write:media scope.
const updateMediaHandler: AuthenticatedApiHandle<Params> = async (
  req,
  context
) => {
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
      data: ERROR_404,
      responseStatusCode: 404
    })
  }

  const payload = await readPayload(req)
  if (!payload) {
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: ERROR_422,
      responseStatusCode: 422
    })
  }

  const parsed = UpdateMediaRequest.safeParse(payload)
  if (!parsed.success) {
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: ERROR_422,
      responseStatusCode: 422
    })
  }

  // Detect which fields the client actually sent from the raw payload (before
  // Zod fills omitted optionals) so a partial update only mutates those fields.
  const descriptionProvided = 'description' in payload
  const focusProvided = 'focus' in payload
  const rawThumbnail = payload.thumbnail
  const thumbnailProvided =
    rawThumbnail instanceof File && rawThumbnail.size > 0

  if (thumbnailProvided) {
    const thumbnailCheck = FileSchema.safeParse(rawThumbnail)
    if (!thumbnailCheck.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: 422
      })
    }
  }

  // Nothing to change — return the current attachment (404 if not owned).
  if (!descriptionProvided && !focusProvided && !thumbnailProvided) {
    const media = await database.getMediaByIdForAccount({
      mediaId: id,
      accountId: account.id
    })
    if (!media) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })
    }
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: getMediaAttachment(media, headerHost(req.headers))
    })
  }

  // Replacing the thumbnail needs the old path (to delete it after a successful
  // update) and produces a new stored thumbnail before touching the DB.
  let oldThumbnailPath: string | undefined
  let thumbnail
  if (thumbnailProvided) {
    const existing = await database.getMediaByIdForAccount({
      mediaId: id,
      accountId: account.id
    })
    if (!existing) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })
    }
    oldThumbnailPath = existing.thumbnail?.path
    thumbnail = await saveMediaThumbnail(database, rawThumbnail as File)
    if (!thumbnail) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: 422
      })
    }
  }

  const media = await database.updateMedia({
    mediaId: id,
    accountId: account.id,
    ...(descriptionProvided ? { description: parsed.data.description } : {}),
    ...(focusProvided ? { focus: parsed.data.focus } : {}),
    ...(thumbnail ? { thumbnail } : {})
  })

  if (!media) {
    // Owner check failed inside updateMedia; clean up the orphaned thumbnail we
    // just stored so it doesn't leak.
    if (thumbnail) {
      await deleteMediaFile(database, thumbnail.path)
    }
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: ERROR_404,
      responseStatusCode: 404
    })
  }

  // Remove the previous thumbnail file once the replacement is persisted.
  if (thumbnail && oldThumbnailPath && oldThumbnailPath !== thumbnail.path) {
    await deleteMediaFile(database, oldThumbnailPath)
  }

  logger.info({
    message: 'Media updated',
    mediaId: id,
    accountId: account.id
  })

  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: getMediaAttachment(media, headerHost(req.headers))
  })
}

export const PUT = traceApiRoute(
  'updateMedia',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:media']],
    updateMediaHandler
  )
)

export const PATCH = traceApiRoute(
  'updateMedia',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:media']],
    updateMediaHandler
  )
)

export const DELETE = traceApiRoute(
  'deleteMedia',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:media']],
    async (req: NextRequest, context) => {
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
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      const result = await database.deleteMediaForAccount({
        mediaId: id,
        accountId: account.id
      })

      // Media already attached to a posted status can't be deleted (Mastodon
      // returns 422 in_usage_error).
      if (result === 'in-use') {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }

      if (result === 'not-found') {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      logger.info({
        message: 'Media deleted',
        mediaId: id,
        accountId: account.id
      })

      // Mastodon's destroy renders an empty object with 200.
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {}
      })
    }
  )
)
