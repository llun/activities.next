import { NextRequest } from 'next/server'

import { UpdateCustomEmojiRequest } from '@/app/api/v1/admin/custom_emojis/schema'
import { AdminApiGuard } from '@/lib/services/guards/AdminApiGuard'
import { toAdminCustomEmoji } from '@/lib/types/domain/customEmoji'
import { getRequestBody } from '@/lib/utils/getRequestBody'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_400,
  ERROR_404,
  ERROR_422,
  HTTP_STATUS,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

type Params = {
  id: string
}

// PATCH matches Mastodon's admin custom-emoji update; PUT mirrors this repo's
// existing admin [id] convention (e.g. domain_blocks). Both share one handler.
const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.PATCH,
  HttpMethod.enum.PUT,
  HttpMethod.enum.DELETE
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'adminGetCustomEmoji',
  AdminApiGuard<Params>(CORS_HEADERS, async (req, { database, params }) => {
    const { id } = await params
    const emoji = await database.getCustomEmojiById(id)
    if (!emoji) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: HTTP_STATUS.NOT_FOUND
      })
    }
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: toAdminCustomEmoji(emoji)
    })
  })
)

const updateHandler = AdminApiGuard<Params>(
  CORS_HEADERS,
  async (req: NextRequest, { database, params }) => {
    let data: unknown
    try {
      data = await getRequestBody(req)
    } catch {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: HTTP_STATUS.BAD_REQUEST
      })
    }

    const parsed = UpdateCustomEmojiRequest.safeParse(data)
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
      })
    }

    const { id } = await params
    const emoji = await database.updateCustomEmoji({
      id,
      category: parsed.data.category,
      visibleInPicker: parsed.data.visible_in_picker,
      disabled: parsed.data.disabled
    })
    if (!emoji) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: HTTP_STATUS.NOT_FOUND
      })
    }

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: toAdminCustomEmoji(emoji)
    })
  }
)

export const PATCH = traceApiRoute('adminUpdateCustomEmoji', updateHandler)
export const PUT = traceApiRoute('adminUpdateCustomEmoji', updateHandler)

export const DELETE = traceApiRoute(
  'adminDeleteCustomEmoji',
  AdminApiGuard<Params>(CORS_HEADERS, async (req, { database, params }) => {
    const { id } = await params
    const emoji = await database.deleteCustomEmoji(id)
    if (!emoji) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: HTTP_STATUS.NOT_FOUND
      })
    }
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: toAdminCustomEmoji(emoji)
    })
  })
)
