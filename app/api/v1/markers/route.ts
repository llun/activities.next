import { z } from 'zod'

import { getMaxTimeOrderedIdForMs } from '@/lib/database/sql/notificationIdRewrite.js'
import { Database } from '@/lib/database/types'
import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { getMastodonMarkers } from '@/lib/services/mastodon/getMastodonMarkers'
import { MarkerTimeline, Scope } from '@/lib/types/database/operations'
import {
  SMALL_REQUEST_BODY_MAX_BYTES,
  isRequestBodyTooLargeError,
  readRequestBodyWithLimit
} from '@/lib/utils/boundedRequestBody'
import { HttpMethod } from '@/lib/utils/http-headers'
import { isPublicId, toPublicIdLookupKey } from '@/lib/utils/publicId'
import { ERROR_413, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST
]

const TIMELINES: MarkerTimeline[] = ['home', 'notifications']

// Marker ids are opaque status/notification ids (an encoded status URL at the
// longest), so a generous cap only rejects abuse; it stops an authenticated
// client from persisting megabytes per marker row.
export const MARKER_LAST_READ_ID_MAX_LENGTH = 2048

const MarkerInput = z.object({
  last_read_id: z.string().min(1).max(MARKER_LAST_READ_ID_MAX_LENGTH)
})
const PostBody = z.object({
  home: MarkerInput.optional(),
  notifications: MarkerInput.optional()
})

export const OPTIONS = defaultOptions(CORS_HEADERS)

const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

export const GET = traceApiRoute(
  'getMarkers',
  OAuthGuardAnyScope<{}>(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req, context) => {
      const { currentActor, database } = context
      const url = new URL(req.url)
      const requested = [
        ...url.searchParams.getAll('timeline[]'),
        ...url.searchParams.getAll('timeline')
      ]
      const timelines = requested.filter((value): value is MarkerTimeline =>
        TIMELINES.includes(value as MarkerTimeline)
      )
      const rows = await database.getMarkers({
        actorId: currentActor.id,
        timelines
      })
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: getMastodonMarkers(rows)
      })
    },
    guardOptions
  )
)

// Notification ids are time-ordered UUIDv7s, and clients compare the
// notifications marker against them by id. A client still holding ids cached
// before the time-ordered-ids migration would otherwise move the marker to a
// v4 id that sorts above every real notification, making everything newer look
// read. So the notifications marker only moves to:
// - a UUIDv7, stored lowercased (the case generatePublicId mints);
// - one of the caller's own notifications, stored as given;
// - an all-digit epoch-ms value, which is what grouped-notification clients
//   such as Phanpy send back: they post `'' + most_recent_notification_id`,
//   and this server emits that field as the group's newest createdAt in epoch
//   ms (see getNotificationGroup.ts). It is stored as the highest UUIDv7 for
//   that millisecond, i.e. "read up to and including then".
// Anything else returns null: the stored marker is left as it is, and the
// response reports that stored marker (or omits the key when there is none).
const MIN_MARKER_EPOCH_MS = Date.UTC(2000, 0, 1)
const MARKER_EPOCH_MS_FUTURE_SLACK = 24 * 60 * 60 * 1000

const resolveNotificationsMarkerId = async (
  database: Pick<Database, 'getNotifications'>,
  actorId: string,
  lastReadId: string
): Promise<string | null> => {
  if (/^\d{1,15}$/.test(lastReadId)) {
    const msecs = Number(lastReadId)
    if (
      msecs >= MIN_MARKER_EPOCH_MS &&
      msecs <= Date.now() + MARKER_EPOCH_MS_FUTURE_SLACK
    ) {
      return getMaxTimeOrderedIdForMs(msecs)
    }
  }
  if (isPublicId(lastReadId)) return toPublicIdLookupKey(lastReadId)
  const [notification] = await database.getNotifications({
    actorId,
    ids: [lastReadId],
    limit: 1,
    includeFiltered: true
  })
  return notification ? lastReadId : null
}

const parseBody = async (req: Request): Promise<unknown> => {
  const contentType = (req.headers.get('content-type') ?? '').toLowerCase()
  // A marker body is a couple of short ids; never buffer more than the cap.
  const bodyBytes = await readRequestBodyWithLimit(
    req,
    SMALL_REQUEST_BODY_MAX_BYTES
  )
  if (contentType.includes('application/json')) {
    const text = bodyBytes.toString('utf-8')
    if (text.trim() === '') return {}
    return JSON.parse(text)
  }
  // Mastodon clients send form fields like `home[last_read_id]`.
  // Both are iterable as [string, …].
  const entries: Iterable<[string, FormDataEntryValue | string]> =
    contentType.includes('multipart/form-data')
      ? await new Response(new Uint8Array(bodyBytes), {
          headers: { 'content-type': req.headers.get('content-type') ?? '' }
        }).formData()
      : new URLSearchParams(bodyBytes.toString('utf-8'))
  const body: Record<string, { last_read_id?: string }> = {}
  for (const [key, value] of entries) {
    if (typeof value !== 'string') continue
    const match = key.match(/^(home|notifications)\[last_read_id\]$/)
    if (match) {
      body[match[1]] = { last_read_id: value }
    }
  }
  return body
}

export const POST = traceApiRoute(
  'updateMarkers',
  OAuthGuardAnyScope<{}>(
    [Scope.enum.write, Scope.enum['write:statuses']],
    async (req, context) => {
      const { currentActor, database } = context

      let json: unknown
      try {
        json = await parseBody(req)
      } catch (error) {
        if (isRequestBodyTooLargeError(error)) {
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: ERROR_413,
            responseStatusCode: 413
          })
        }
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'Invalid request body' },
          responseStatusCode: 400
        })
      }

      const parsed = PostBody.safeParse(json)
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'Invalid marker' },
          responseStatusCode: 422
        })
      }

      const written = []
      for (const timeline of TIMELINES) {
        const input = parsed.data[timeline]
        if (!input) continue
        const lastReadId =
          timeline === 'notifications'
            ? await resolveNotificationsMarkerId(
                database,
                currentActor.id,
                input.last_read_id
              )
            : input.last_read_id
        if (lastReadId === null) {
          written.push(
            ...(await database.getMarkers({
              actorId: currentActor.id,
              timelines: [timeline]
            }))
          )
          continue
        }
        written.push(
          await database.upsertMarker({
            actorId: currentActor.id,
            timeline,
            lastReadId
          })
        )
      }

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: getMastodonMarkers(written)
      })
    },
    guardOptions
  )
)
