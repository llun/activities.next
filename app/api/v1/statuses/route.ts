import { z } from 'zod'

import { createNoteFromUserInput } from '@/lib/actions/createNote'
import { createPollFromUserInput } from '@/lib/actions/createPoll'
import { PUBLISH_SCHEDULED_STATUS_JOB_NAME } from '@/lib/jobs/names'
import {
  OAuthGuardAnyScope,
  OptionalOAuthGuard,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import {
  MAX_POLL_EXPIRATION_SECONDS,
  MAX_POLL_OPTIONS,
  MAX_POLL_OPTION_CHARS,
  MAX_STATUS_MEDIA_ATTACHMENTS,
  MIN_POLL_EXPIRATION_SECONDS,
  MIN_POLL_OPTIONS,
  MIN_SCHEDULED_STATUS_AHEAD_MS,
  SCHEDULED_AT_TOO_SOON_ERROR
} from '@/lib/services/mastodon/constants'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { getQueue } from '@/lib/services/queue'
import { canActorReadStatus } from '@/lib/services/statusAccess'
import { getAttachmentsFromMediaIds } from '@/lib/services/statuses/mediaIds'
import { parseStatusRequestBody } from '@/lib/services/statuses/parseStatusRequestBody'
import {
  buildScheduledParams,
  toMastodonScheduledStatus
} from '@/lib/services/statuses/scheduledStatusSerializer'
import { Mastodon } from '@/lib/types/activitypub'
import { Scope } from '@/lib/types/database/operations'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_400,
  ERROR_422,
  ERROR_500,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'
import { Booleanish } from '@/lib/utils/zodBooleanish'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST
]

// Mastodon does not document a cap; bound the batch to keep per-request work
// predictable.
const MAX_BATCH_STATUSES = 100

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
    scheduled_at: z.string().optional(),
    poll: PollSchema.optional()
  })
  .refine(
    (note) =>
      note.status.trim().length > 0 ||
      note.media_ids.length > 0 ||
      (note.poll?.options.length ?? 0) > 0
  )

// GET /api/v1/statuses?id[]=1&id[]=2 — batch-fetch multiple statuses at once.
// https://docs.joinmastodon.org/methods/statuses/#index
export const GET = traceApiRoute(
  'getStatusesByIds',
  OptionalOAuthGuard(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req, context) => {
      const { database, currentActor } = context
      const searchParams = new URL(req.url).searchParams
      const requestedIds = [
        ...searchParams.getAll('id[]'),
        ...searchParams.getAll('id')
      ]
      const uniqueIds = [...new Set(requestedIds)].slice(0, MAX_BATCH_STATUSES)
      // Hydrate every requested status in a single batched round-trip instead of
      // calling getStatus per id, which would fan out into a large N+1 of
      // recipient/attachment/like/bookmark queries for a 100-id batch.
      const statusesData = await database.getStatusesByIds({
        statusIds: uniqueIds.map(idToUrl),
        currentActorId: currentActor?.id
      })
      const resolved = await Promise.all(
        statusesData.map(async (status) => {
          const hasAccess = await canActorReadStatus({
            database,
            status,
            currentActor
          })
          if (!hasAccess) return null
          return getMastodonStatus(database, status, currentActor?.id)
        })
      )
      const statuses = resolved.filter((s): s is Mastodon.Status => s !== null)
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: statuses })
    },
    { errorResponse: corsErrorResponse(CORS_HEADERS), matchMode: 'any' }
  )
)

export const POST = traceApiRoute(
  'createStatus',
  OAuthGuardAnyScope(
    [Scope.enum.write, Scope.enum['write:statuses']],
    async (req, context) => {
      const { currentActor, database, clientId } = context
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

        const idempotencyKey = req.headers.get('Idempotency-Key')?.trim()

        // A scheduled_at at least five minutes ahead stores the status for later
        // publication (Task 14) instead of posting it now. Media is validated
        // here too, so a scheduled status never references nonexistent media.
        if (note.scheduled_at) {
          const scheduledAt = Date.parse(note.scheduled_at)
          if (
            Number.isNaN(scheduledAt) ||
            scheduledAt - Date.now() < MIN_SCHEDULED_STATUS_AHEAD_MS
          ) {
            return apiResponse({
              req,
              allowedMethods: CORS_HEADERS,
              data: { error: SCHEDULED_AT_TOO_SOON_ERROR },
              responseStatusCode: 422
            })
          }

          if (!note.poll) {
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
          }

          const scheduled = await database.createScheduledStatus({
            actorId: currentActor.id,
            scheduledAt,
            params: buildScheduledParams(note, idempotencyKey ?? null)
          })
          // Enqueue the publish job with a delay until the scheduled time. On
          // QStash the delay is honored natively; the in-process NoQueue has no
          // scheduler and drops delayed messages, so scheduled statuses only
          // auto-fire when a real queue is configured.
          await getQueue().publish({
            id: getHashFromString(scheduled.id),
            name: PUBLISH_SCHEDULED_STATUS_JOB_NAME,
            data: { scheduledStatusId: scheduled.id },
            delaySeconds: Math.max(
              0,
              Math.floor((scheduled.scheduledAt - Date.now()) / 1000)
            )
          })
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: await toMastodonScheduledStatus(database, scheduled)
          })
        }

        // Honor Idempotency-Key: a repeated key returns the original status
        // rather than creating a duplicate.
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

        // When the request authenticated via an OAuth app token, record the
        // owning client as the status's Mastodon "application". Web-session
        // creates have no clientId and leave application null.
        const client = clientId
          ? await database.getClientFromId({ clientId })
          : null
        const application = client?.name
          ? { name: client.name, website: client.website ?? null }
          : undefined

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
            application,
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
            application,
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
