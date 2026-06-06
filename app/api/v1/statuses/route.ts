import { z } from 'zod'

import { createNoteFromUserInput } from '@/lib/actions/createNote'
import { createPollFromUserInput } from '@/lib/actions/createPoll'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import {
  MAX_POLL_EXPIRATION_SECONDS,
  MAX_POLL_OPTIONS,
  MAX_POLL_OPTION_CHARS,
  MAX_STATUS_MEDIA_ATTACHMENTS,
  MIN_POLL_EXPIRATION_SECONDS,
  MIN_POLL_OPTIONS
} from '@/lib/services/mastodon/constants'
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
import { Booleanish } from '@/lib/utils/zodBooleanish'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const VisibilitySchema = z.enum(['public', 'unlisted', 'private', 'direct'])

const PollSchema = z.object({
  options: z
    .array(z.string().trim().min(1).max(MAX_POLL_OPTION_CHARS))
    .min(MIN_POLL_OPTIONS)
    .max(MAX_POLL_OPTIONS),
  expires_in: z.coerce
    .number()
    .int()
    .min(MIN_POLL_EXPIRATION_SECONDS)
    .max(MAX_POLL_EXPIRATION_SECONDS),
  multiple: Booleanish.optional().default(false),
  hide_totals: Booleanish.optional().default(false)
})

const NoteSchema = z
  .object({
    status: z.string().optional().default(''),
    in_reply_to_id: z.string().optional(),
    spoiler_text: z.string().optional(),
    media_ids: z.array(z.coerce.string()).optional().default([]),
    visibility: VisibilitySchema.optional(),
    language: z.string().trim().min(1).optional(),
    sensitive: Booleanish.optional().default(false),
    poll: PollSchema.optional()
  })
  .refine(
    (note) =>
      note.status.trim().length > 0 ||
      note.media_ids.length > 0 ||
      (note.poll?.options.length ?? 0) > 0
  )

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

        // A status carries either media or a poll, never both.
        if (note.poll && note.media_ids.length > 0) {
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: ERROR_422,
            responseStatusCode: 422
          })
        }

        // Honor Idempotency-Key: a repeated key returns the original status
        // rather than creating a duplicate.
        const idempotencyKey = req.headers.get('Idempotency-Key')?.trim()
        if (idempotencyKey) {
          const existingStatusId = await database.getIdempotentStatusId({
            actorId: currentActor.id,
            key: idempotencyKey
          })
          if (existingStatusId) {
            const existingStatus = await database.getStatus({
              statusId: existingStatusId,
              currentActorId: currentActor.id
            })
            const existingMastodonStatus = existingStatus
              ? await getMastodonStatus(
                  database,
                  existingStatus,
                  currentActor.id
                )
              : null
            if (existingMastodonStatus) {
              return apiResponse({
                req,
                allowedMethods: CORS_HEADERS,
                data: existingMastodonStatus
              })
            }
          }
        }

        let status
        if (note.poll) {
          status = await createPollFromUserInput({
            text: note.status,
            summary: note.spoiler_text,
            replyStatusId: note.in_reply_to_id,
            currentActor,
            choices: note.poll.options,
            endAt: Date.now() + note.poll.expires_in * 1000,
            pollType: note.poll.multiple ? 'anyOf' : 'oneOf',
            visibility: note.visibility,
            sensitive: note.sensitive,
            language: note.language ?? null,
            database
          })
        } else {
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
          status = await createNoteFromUserInput({
            currentActor,
            text: note.status,
            summary: note.spoiler_text,
            replyNoteId: note.in_reply_to_id,
            visibility: note.visibility,
            attachments,
            sensitive: note.sensitive,
            language: note.language ?? null,
            database
          })
        }
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

        if (idempotencyKey) {
          await database.saveIdempotencyKey({
            actorId: currentActor.id,
            key: idempotencyKey,
            statusId: status.id
          })
        }

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
