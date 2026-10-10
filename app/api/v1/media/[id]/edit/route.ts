import { NextRequest } from 'next/server'
import { z } from 'zod'

import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { MAX_MASKS } from '@/lib/services/medias/edit/recipe'
import {
  EDIT_MASK_MAX_BYTES,
  EDIT_MASK_MIME_TYPE,
  EDIT_RENDER_MAX_BYTES,
  EDIT_RENDER_MIME_TYPES,
  ERROR_INVALID_MASK,
  ERROR_RECORD_NOT_FOUND,
  MediaEditResult,
  getMediaEdit,
  saveMediaEdit
} from '@/lib/services/medias/edit/saveMediaEdit'
import { FocusSchema } from '@/lib/services/medias/types'
import { exceedsMaxMediaUploadSize } from '@/lib/services/medias/uploadSizeLimit'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_401, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// Attach the route's CORS allow-list to the guard's auth-failure responses so
// cross-origin clients can read 401/403/500 instead of an opaque CORS error.
const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

interface Params {
  id: string
}

const SaveEditRequest = z.object({
  file: z.instanceof(File),
  recipe: z.string().min(1),
  base_version: z
    .string()
    .regex(/^\d+$/)
    .transform((value) => Number(value))
    .pipe(z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)),
  save_id: z.string().uuid(),
  apply_to_posts: z.enum(['update', 'gallery']).optional(),
  focus: FocusSchema.optional()
})

// `mask_<id>`: the PNG of one new or changed mask, keyed by its recipe id.
const MASK_PART_PATTERN = /^mask_(.*)$/
const MASK_ID_PATTERN = /^[a-z0-9]{8}$/

type MaskPart = { id: string; file: File }

/**
 * The form's `mask_<id>` parts, or the error to answer: each must name a valid
 * mask id once, be an `image/png` file and fit the 2 MiB cap. That the id is a
 * mask of the recipe, and that the PNG has the photo's shape, the service
 * checks.
 */
const readMaskParts = (
  form: FormData
):
  | { ok: true; parts: MaskPart[] }
  | { ok: false; status: 413 | 422; error: string } => {
  const parts: MaskPart[] = []
  for (const key of new Set(form.keys())) {
    const id = MASK_PART_PATTERN.exec(key)?.[1]
    if (id === undefined) continue
    const values = form.getAll(key)
    const value = values[0]
    if (
      !MASK_ID_PATTERN.test(id) ||
      values.length !== 1 ||
      !(value instanceof File) ||
      value.type !== EDIT_MASK_MIME_TYPE
    ) {
      return { ok: false, status: 422, error: ERROR_INVALID_MASK }
    }
    if (value.size > EDIT_MASK_MAX_BYTES) {
      return { ok: false, status: 413, error: 'The mask image is too large' }
    }
    parts.push({ id, file: value })
  }
  if (parts.length > MAX_MASKS) {
    return { ok: false, status: 422, error: ERROR_INVALID_MASK }
  }
  return { ok: true, parts }
}

const toResponse = <T>(req: NextRequest, result: MediaEditResult<T>) =>
  result.ok
    ? apiResponse({ req, allowedMethods: CORS_HEADERS, data: result.body })
    : apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: result.body,
        responseStatusCode: result.status
      })

const notFound = (req: NextRequest) =>
  apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: { error: ERROR_RECORD_NOT_FOUND },
    responseStatusCode: 404
  })

const invalid = (req: NextRequest, error: string, status: 413 | 422 = 422) =>
  apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: { error },
    responseStatusCode: status
  })

// GET /api/v1/media/:id/edit — the photo edit state of a media the caller
// owns: the owner media entity, the stored recipe, the source the editor
// renders from, how many posts use the photo, and what the editor may offer.
// Same scopes as the media routes.
export const GET = traceApiRoute(
  'getMediaEdit',
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
      if (!id) return notFound(req)

      return toResponse(
        req,
        await getMediaEdit({
          database,
          mediaId: id,
          accountId: account.id,
          host: headerHost(req.headers)
        })
      )
    },
    guardOptions
  )
)

// POST /api/v1/media/:id/edit — saves the client's render of a recipe as the
// photo's live file. Multipart: `file` (JPEG or PNG), `recipe` (JSON),
// `base_version`, `save_id`, `apply_to_posts` (when the photo is in posts), an
// optional `focus`, and a `mask_<id>` PNG for each new or changed subject or
// brush mask. The service does the rest (see saveMediaEdit).
export const POST = traceApiRoute(
  'saveMediaEdit',
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
      if (!id) return notFound(req)

      let form: FormData
      try {
        form = await req.formData()
      } catch {
        return invalid(req, 'Expected a multipart form')
      }

      const payload: Record<string, unknown> = {}
      for (const key of [
        'file',
        'recipe',
        'base_version',
        'save_id',
        'apply_to_posts',
        'focus'
      ]) {
        const value = form.get(key)
        // An empty field reads as missing, like the media routes.
        if (value !== null && value !== '') payload[key] = value
      }
      const parsed = SaveEditRequest.safeParse(payload)
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        return invalid(
          req,
          issue?.path.length
            ? `Invalid ${issue.path.join('.')}`
            : 'Invalid input'
        )
      }

      const { file } = parsed.data
      if (!EDIT_RENDER_MIME_TYPES.includes(file.type)) {
        return invalid(req, 'The edited image must be a JPEG or PNG')
      }
      if (
        file.size > EDIT_RENDER_MAX_BYTES ||
        (await exceedsMaxMediaUploadSize([file.size], database))
      ) {
        return invalid(req, 'The edited image is too large', 413)
      }

      const maskParts = readMaskParts(form)
      if (!maskParts.ok) {
        return invalid(req, maskParts.error, maskParts.status)
      }

      return toResponse(
        req,
        await saveMediaEdit({
          database,
          actor: currentActor,
          accountId: account.id,
          mediaId: id,
          host: headerHost(req.headers),
          file: {
            buffer: Buffer.from(await file.arrayBuffer()),
            size: file.size
          },
          recipe: parsed.data.recipe,
          baseVersion: parsed.data.base_version,
          saveId: parsed.data.save_id,
          applyToPosts: parsed.data.apply_to_posts,
          focus: parsed.data.focus,
          masks: await Promise.all(
            maskParts.parts.map(async ({ id, file: part }) => ({
              id,
              buffer: Buffer.from(await part.arrayBuffer()),
              size: part.size
            }))
          )
        })
      )
    },
    guardOptions
  )
)
