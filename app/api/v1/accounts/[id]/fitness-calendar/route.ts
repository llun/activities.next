import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import {
  FitnessCalendarQuery,
  describeCalendarQueryError
} from '@/lib/services/fitness-files/calendarQuery'
import { AppRouterParams } from '@/lib/services/guards/types'
import { resolveActorIdParam } from '@/lib/services/mastodon/resolveClientId'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import {
  ERROR_400,
  ERROR_401,
  ERROR_403,
  ERROR_500,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

/**
 * Per-local-day totals for the signed-in actor's days `from` to `to`
 * (inclusive) in `time_zone`, ascending by date, optionally narrowed to one
 * stored `activity_type`. A day without a countable activity has no entry.
 * Days are bucketed in `time_zone` by the same function that built the
 * window, so an entry always matches that day's day-details read.
 */
export const GET = traceApiRoute(
  'getAccountFitnessCalendar',
  async (req: NextRequest, params: AppRouterParams<Params>) => {
    const database = getDatabase()
    if (!database) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }

    const session = await getServerAuthSession()
    if (!session?.user?.email) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_401,
        responseStatusCode: 401
      })
    }

    const currentActor = await getActorFromSession(database, session)
    if (!currentActor) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_401,
        responseStatusCode: 401
      })
    }

    const { id: encodedAccountId } = await params.params
    if (!encodedAccountId) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }
    const id = await resolveActorIdParam(database, encodedAccountId)

    if (currentActor.id !== id) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_403,
        responseStatusCode: 403
      })
    }

    const url = new URL(req.url)
    const parsed = FitnessCalendarQuery.safeParse(
      Object.fromEntries(url.searchParams.entries())
    )
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: describeCalendarQueryError(parsed.error) },
        responseStatusCode: 400
      })
    }

    try {
      const calendarDays = await database.getFitnessActivityCalendarData({
        actorId: currentActor.id,
        startDate: parsed.data.startMs,
        endDate: parsed.data.endMs,
        timeZone: parsed.data.timeZone,
        activityType: parsed.data.activityType
      })
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: calendarDays
      })
    } catch (error) {
      logger.error({
        message: 'Failed to load fitness calendar',
        actorId: currentActor.id,
        err: toLoggableError(error)
      })
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }
  },
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { accountId: params?.id || 'unknown' }
    }
  }
)
