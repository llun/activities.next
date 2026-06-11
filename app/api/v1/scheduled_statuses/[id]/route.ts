import { NextRequest } from 'next/server'
import { z } from 'zod'

import { PUBLISH_SCHEDULED_STATUS_JOB_NAME } from '@/lib/jobs/names'
import {
  OAuthGuard,
  OAuthGuardAnyScope
} from '@/lib/services/guards/OAuthGuard'
import {
  MIN_SCHEDULED_STATUS_AHEAD_MS,
  SCHEDULED_AT_TOO_SOON_ERROR
} from '@/lib/services/mastodon/constants'
import { getQueue } from '@/lib/services/queue'
import {
  scheduledDelaySeconds,
  toMastodonScheduledStatus
} from '@/lib/services/statuses/scheduledStatusSerializer'
import { Scope } from '@/lib/types/database/operations'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_404,
  ERROR_422,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.PUT,
  HttpMethod.enum.DELETE
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

const ScheduleUpdateSchema = z.object({ scheduled_at: z.string() })

const notFound = (req: NextRequest) =>
  apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: ERROR_404,
    responseStatusCode: 404
  })

// Reads the request body across the content types Mastodon clients use (JSON,
// urlencoded, multipart). Returns null on a malformed body so the caller can
// surface a 422.
const readBody = async (
  req: NextRequest
): Promise<Record<string, unknown> | null> => {
  const contentType = req.headers.get('content-type')?.toLowerCase() ?? ''
  try {
    if (contentType.includes('application/json')) {
      const text = await req.text()
      if (text.trim() === '') return {}
      const parsed: unknown = JSON.parse(text)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    }
    const form = await req.formData()
    return Object.fromEntries(form.entries())
  } catch {
    return null
  }
}

export const GET = traceApiRoute(
  'getScheduledStatus',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req, { database, currentActor, params }) => {
      const { id } = (await params) ?? { id: undefined }
      if (!id) return notFound(req)

      const scheduled = await database.getScheduledStatus({
        actorId: currentActor.id,
        id
      })
      if (!scheduled) return notFound(req)

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: await toMastodonScheduledStatus(database, scheduled)
      })
    }
  )
)

// https://docs.joinmastodon.org/methods/scheduled_statuses/#update
// Mastodon's PUT only reschedules; it updates scheduled_at and nothing else.
export const PUT = traceApiRoute(
  'updateScheduledStatus',
  OAuthGuard<Params>(
    [Scope.enum['write:statuses']],
    async (req, { database, currentActor, params }) => {
      const { id } = (await params) ?? { id: undefined }
      if (!id) return notFound(req)

      const body = await readBody(req)
      if (!body) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }

      const parsed = ScheduleUpdateSchema.safeParse(body)
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }

      const scheduledAt = Date.parse(parsed.data.scheduled_at)
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

      const scheduled = await database.updateScheduledStatusAt({
        actorId: currentActor.id,
        id,
        scheduledAt
      })
      if (!scheduled) return notFound(req)

      // Re-enqueue the publish job with the new delay so the status fires at the
      // rescheduled time. The deduplication id is stable per scheduled status,
      // and the job re-reads the row, so the latest scheduledAt always wins.
      await getQueue().publish({
        id: getHashFromString(scheduled.id),
        name: PUBLISH_SCHEDULED_STATUS_JOB_NAME,
        data: { scheduledStatusId: scheduled.id },
        delaySeconds: scheduledDelaySeconds(scheduled.scheduledAt)
      })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: await toMastodonScheduledStatus(database, scheduled)
      })
    }
  )
)

export const DELETE = traceApiRoute(
  'deleteScheduledStatus',
  OAuthGuard<Params>(
    [Scope.enum['write:statuses']],
    async (req, { database, currentActor, params }) => {
      const { id } = (await params) ?? { id: undefined }
      if (!id) return notFound(req)

      const deleted = await database.deleteScheduledStatus({
        actorId: currentActor.id,
        id
      })
      if (!deleted) return notFound(req)

      // Mastodon's destroy renders an empty object with 200.
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
    }
  )
)
