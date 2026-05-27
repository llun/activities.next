import { z } from 'zod'

import { createNoteFromUserInput } from '@/lib/actions/createNote'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { MAX_STATUS_MEDIA_ATTACHMENTS } from '@/lib/services/mastodon/constants'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { getAttachmentsFromMediaIds } from '@/lib/services/statuses/mediaIds'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_400,
  ERROR_422,
  ERROR_500,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const VisibilitySchema = z.enum(['public', 'unlisted', 'private', 'direct'])

const NoteSchema = z
  .object({
    status: z.string().optional().default(''),
    in_reply_to_id: z.string().optional(),
    spoiler_text: z.string().optional(),
    media_ids: z.array(z.coerce.string()).optional().default([]),
    visibility: VisibilitySchema.optional()
  })
  .refine((note) => note.status.trim().length > 0 || note.media_ids.length > 0)

const FORM_URL_ENCODED_CONTENT_TYPE = 'application/x-www-form-urlencoded'
const FORM_CONTENT_TYPES = [
  'multipart/form-data',
  FORM_URL_ENCODED_CONTENT_TYPE
]

const isFormRequest = (req: Request) => {
  const contentType = req.headers.get('content-type')?.toLowerCase()
  return FORM_CONTENT_TYPES.some((type) => contentType?.includes(type))
}

const getFormString = (form: FormData, name: string) => {
  const value = form.get(name)
  return typeof value === 'string' ? value : undefined
}

const getFormStringArray = (form: FormData, ...names: string[]) =>
  names
    .flatMap((name) => form.getAll(name))
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

const getSearchParamString = (params: URLSearchParams, name: string) => {
  const value = params.get(name)
  return value === null ? undefined : value
}

const getSearchParamStringArray = (
  params: URLSearchParams,
  ...names: string[]
) =>
  names
    .flatMap((name) => params.getAll(name))
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

const getNoteRequestInput = async (req: Request): Promise<unknown> => {
  if (!isFormRequest(req)) {
    return req.json()
  }

  const contentType = req.headers.get('content-type')?.toLowerCase()
  if (contentType?.includes(FORM_URL_ENCODED_CONTENT_TYPE)) {
    const params = new URLSearchParams(await req.text())
    return {
      status: getSearchParamString(params, 'status') ?? '',
      in_reply_to_id: getSearchParamString(params, 'in_reply_to_id'),
      spoiler_text: getSearchParamString(params, 'spoiler_text'),
      media_ids: getSearchParamStringArray(params, 'media_ids', 'media_ids[]'),
      visibility: getSearchParamString(params, 'visibility')
    }
  }

  const form = await req.formData()
  return {
    status: getFormString(form, 'status') ?? '',
    in_reply_to_id: getFormString(form, 'in_reply_to_id'),
    spoiler_text: getFormString(form, 'spoiler_text'),
    media_ids: getFormStringArray(form, 'media_ids', 'media_ids[]'),
    visibility: getFormString(form, 'visibility')
  }
}

export const POST = traceApiRoute(
  'createStatus',
  OAuthGuardAnyScope(
    [Scope.enum.write, Scope.enum['write:statuses']],
    async (req, context) => {
      const { currentActor, database } = context
      try {
        const content = await getNoteRequestInput(req)
        const parsed = NoteSchema.safeParse(content)
        if (!parsed.success) {
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: ERROR_422,
            responseStatusCode: 422
          })
        }
        const note = parsed.data
        const mediaIds = [...new Set(note.media_ids)]
        if (mediaIds.length > MAX_STATUS_MEDIA_ATTACHMENTS) {
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: ERROR_422,
            responseStatusCode: 422
          })
        }
        const attachments = await getAttachmentsFromMediaIds(
          database,
          currentActor,
          mediaIds
        )
        if (!attachments) {
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: ERROR_422,
            responseStatusCode: 422
          })
        }
        const status = await createNoteFromUserInput({
          currentActor,
          text: note.status,
          summary: note.spoiler_text,
          replyNoteId: note.in_reply_to_id,
          visibility: note.visibility,
          attachments,
          database
        })
        if (!status)
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: ERROR_422,
            responseStatusCode: 422
          })

        const mastodonStatus = await getMastodonStatus(
          database,
          status,
          currentActor.id
        )
        if (!mastodonStatus)
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: ERROR_500,
            responseStatusCode: 500
          })

        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: mastodonStatus
        })
      } catch {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })
      }
    }
  )
)
