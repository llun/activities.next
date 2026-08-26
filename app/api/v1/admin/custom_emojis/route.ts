import { NextRequest } from 'next/server'

import { CreateCustomEmojiRequest } from '@/app/api/v1/admin/custom_emojis/schema'
import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { AdminApiGuard } from '@/lib/services/guards/AdminApiGuard'
import { deleteMediaFile, saveMedia } from '@/lib/services/medias'
import { ACCEPTED_IMAGE_TYPES } from '@/lib/services/medias/constants'
import { getMediaPathFromFileUrl } from '@/lib/services/medias/mediaFileUrl'
import { FileSchema } from '@/lib/services/medias/types'
import { exceedsMaxMediaUploadSize } from '@/lib/services/medias/uploadSizeLimit'
import { toAdminCustomEmoji } from '@/lib/types/domain/customEmoji'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import {
  ERROR_403,
  ERROR_422,
  ERROR_500,
  HTTP_STATUS,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { toLoggableError } from '@/lib/utils/toLoggableError'
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

    // The upload cap lives in the resolved `media.maxFileSize` server setting
    // (a database read), so it is checked here rather than in FileSchema.
    if (await exceedsMaxMediaUploadSize([fileParsed.data.size], database)) {
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
    let emoji
    try {
      emoji = await database.createCustomEmoji({
        shortcode: parsed.data.shortcode,
        url: saved.url,
        staticUrl: saved.url,
        category: parsed.data.category,
        visibleInPicker: parsed.data.visible_in_picker ?? true
      })
    } catch (error) {
      // Insert can still fail if a concurrent request inserted the same
      // shortcode after the pre-check above (unique constraint), or for an
      // unrelated DB error. In both cases the just-saved media is now orphaned,
      // so remove it best-effort. Re-query to tell a genuine duplicate (→ 422)
      // apart from a transient error (→ 500) instead of always blaming the
      // shortcode.
      await deleteSavedMedia(database, saved.url, parsed.data.shortcode)
      logger.warn({
        message: 'Failed to create custom emoji after media upload',
        shortcode: parsed.data.shortcode,
        err: toLoggableError(error)
      })
      const duplicate = await database
        .getCustomEmojiByShortcode(parsed.data.shortcode)
        .catch(() => null)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: duplicate ? { error: 'Shortcode already exists' } : ERROR_500,
        responseStatusCode: duplicate
          ? HTTP_STATUS.UNPROCESSABLE_ENTITY
          : HTTP_STATUS.INTERNAL_SERVER_ERROR
      })
    }

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: toAdminCustomEmoji(emoji)
    })
  })
)

// Best-effort cleanup of the media file this route just saved.
//
// The path comes back through the shared, host-aware `getMediaPathFromFileUrl`
// (AGENTS.md, "A stored media URL is only ours if the host says so"). Its null
// is the point at a call site that ends in an unlink: `getAttachmentMediaPath`
// fits this input too and never returns null, but it falls back to the whole
// pathname, which is the wrong default for a delete. The host check is
// redundant here rather than load-bearing — `saved.url` was minted from
// `getConfig().host` — and simply costs nothing. Its `isTraversingStoragePath`
// half is not redundant: `deleteMediaFile` resolves the path against the
// storage root and unlinks it, with no containment check of its own.
const deleteSavedMedia = async (
  database: Database,
  url: string,
  shortcode: string
) => {
  const path = getMediaPathFromFileUrl(url, getConfig())
  if (!path) return
  // Cleanup is best effort, but a failure here orphans the stored file, so it
  // cannot be silent.
  await deleteMediaFile(database, path).catch((error) =>
    logger.warn({
      message: 'Failed to remove orphaned media after custom emoji insert',
      shortcode,
      err: toLoggableError(error)
    })
  )
}
