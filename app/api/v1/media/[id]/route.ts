import { z } from 'zod'

import {
  OAuthGuard,
  OAuthGuardAnyScope
} from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getMediaAttachment } from '@/lib/services/medias/getMediaAttachment'
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
  HttpMethod.enum.PUT
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

// `description` is stored in a varchar(255) column; cap it to avoid a runtime
// DB error. Empty/whitespace-only (and explicit null) descriptions are
// normalised to null so clients can clear alt text by sending "" or null.
const UpdateMediaRequest = z.object({
  description: z
    .string()
    .max(255)
    .nullable()
    .optional()
    .transform((value) => (value && value.trim() ? value : null))
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

export const GET = traceApiRoute(
  'getMedia',
  OAuthGuard<Params>([Scope.enum.read], async (req, context) => {
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
  })
)

export const PUT = traceApiRoute(
  'updateMedia',
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

      // Only mutate fields the client actually sent so a metadata-only update
      // (e.g. focus, which we don't persist yet) doesn't clear the description.
      const descriptionProvided = 'description' in payload
      const media = descriptionProvided
        ? await database.updateMedia({
            mediaId: id,
            accountId: account.id,
            description: parsed.data.description
          })
        : await database.getMediaByIdForAccount({
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
  )
)
