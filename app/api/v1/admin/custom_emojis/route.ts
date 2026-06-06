import { NextRequest } from 'next/server'

import { CreateCustomEmojiRequest } from '@/app/api/v1/admin/custom_emojis/schema'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { AdminApiGuard } from '@/lib/services/guards/AdminApiGuard'
import { saveMedia } from '@/lib/services/medias'
import { ACCEPTED_IMAGE_TYPES } from '@/lib/services/medias/constants'
import { FileSchema } from '@/lib/services/medias/types'
import { toAdminCustomEmoji } from '@/lib/types/domain/customEmoji'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_403,
  ERROR_422,
  ERROR_500,
  HTTP_STATUS,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'adminListCustomEmojis',
  AdminApiGuard(CORS_HEADERS, async (req: NextRequest, { database }) => {
    const emojis = await database.getCustomEmojis({ includeDisabled: true })
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: emojis.map(toAdminCustomEmoji)
    })
  })
)

export const POST = traceApiRoute(
  'adminCreateCustomEmoji',
  AdminApiGuard(CORS_HEADERS, async (req: NextRequest, { database }) => {
    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
      })
    }

    const parsed = CreateCustomEmojiRequest.safeParse({
      shortcode: form.get('shortcode') ?? undefined,
      category: form.get('category') ?? undefined,
      visible_in_picker: form.get('visible_in_picker') ?? undefined
    })
    const fileParsed = FileSchema.safeParse(form.get('image'))
    // Custom emoji are static images only. FileSchema also accepts video/audio,
    // so narrow to image mime types here (we do not transcode animated emoji).
    if (
      !parsed.success ||
      !fileParsed.success ||
      !ACCEPTED_IMAGE_TYPES.includes(fileParsed.data.type)
    ) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
      })
    }

    const existing = await database.getCustomEmojiByShortcode(
      parsed.data.shortcode
    )
    if (existing) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Shortcode already exists' },
        responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
      })
    }

    // The upload goes through the shared media pipeline, which is actor-scoped.
    // Use the uploading admin's actor. This requires a browser session; an
    // OAuth-token-only admin (no session actor) cannot upload here.
    const session = await getServerAuthSession()
    const actor = await getActorFromSession(database, session)
    if (!actor) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_403,
        responseStatusCode: HTTP_STATUS.FORBIDDEN
      })
    }

    let saved
    try {
      saved = await saveMedia(database, actor, { file: fileParsed.data })
    } catch {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
      })
    }
    if (!saved) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR
      })
    }

    // We do not transcode animated emoji; the static copy equals the upload.
    const emoji = await database.createCustomEmoji({
      shortcode: parsed.data.shortcode,
      url: saved.url,
      staticUrl: saved.url,
      category: parsed.data.category,
      visibleInPicker: parsed.data.visible_in_picker ?? true
    })

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: toAdminCustomEmoji(emoji)
    })
  })
)
