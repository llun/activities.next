import { z } from 'zod'

import { createNoteFromUserInput } from '@/lib/actions/createNote'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { MAX_STATUS_MEDIA_ATTACHMENTS } from '@/lib/services/mastodon/constants'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { getAttachmentsFromMediaIds } from '@/lib/services/statuses/mediaIds'
import { parseStatusRequestBody } from '@/lib/services/statuses/parseStatusRequestBody'
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

export const POST = traceApiRoute(
  'createStatus',
  OAuthGuardAnyScope(
    [Scope.enum.write, Scope.enum['write:statuses']],
    async (req, context) => {
      const { currentActor, database } = context
      try {
        const content = await parseStatusRequestBody(req)
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
