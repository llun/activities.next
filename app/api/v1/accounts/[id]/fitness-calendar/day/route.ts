import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { Database } from '@/lib/database/types'
import type {
  FitnessDayActivitiesPage,
  FitnessDayActivity,
  FitnessWindowActivity
} from '@/lib/fitness/calendar/types'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActivityTitle } from '@/lib/services/fitness-files/activityTitle'
import {
  FitnessCalendarDayQuery,
  describeCalendarQueryError
} from '@/lib/services/fitness-files/calendarQuery'
import { AppRouterParams } from '@/lib/services/guards/types'
import { resolveActorIdParam } from '@/lib/services/mastodon/resolveClientId'
import { Status, StatusType } from '@/lib/types/domain/status'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { getStatusDetailPath } from '@/lib/utils/getStatusDetailPath'
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
 * The post behind an activity, but only one the actor owns. A fitness file
 * always links its owner's own post; the check makes that structural, so a
 * row can never surface another actor's text or link even if the column
 * pointed elsewhere.
 */
const getOwnPost = (
  statusesById: Map<string, Status>,
  actorId: string,
  statusId: string | null
) => {
  if (!statusId) return null
  const status = statusesById.get(statusId)
  if (!status || status.actorId !== actorId) return null
  if (status.type === StatusType.enum.Announce) return null
  return status
}

const toDayActivities = async (
  database: Pick<Database, 'getStatusesByIds'>,
  actorId: string,
  rows: FitnessWindowActivity[]
): Promise<FitnessDayActivity[]> => {
  const statusIds = [
    ...new Set(
      rows
        .map((row) => row.statusId)
        .filter((statusId): statusId is string => Boolean(statusId))
    )
  ]
  // One batched read. No `visibleToActorId`: like the gear activities route,
  // these are the caller's own posts reached through their own
  // `fitness_files` rows, which the owner sees whatever their visibility. A
  // post deleted between the two queries is simply absent from the result.
  const statuses =
    statusIds.length > 0
      ? await database.getStatusesByIds({
          statusIds,
          currentActorId: actorId,
          withReplies: false
        })
      : []
  const statusesById = new Map(statuses.map((status) => [status.id, status]))

  return rows.map((row) => {
    const post = getOwnPost(statusesById, actorId, row.statusId)
    const statusPath = post ? getStatusDetailPath(post) : null
    return {
      id: row.id,
      activityType: row.activityType,
      startTime: row.startTime,
      totalDistanceMeters: row.totalDistanceMeters,
      totalDurationSeconds: row.totalDurationSeconds,
      elevationGainMeters: row.elevationGainMeters,
      title:
        post && statusPath
          ? getActivityTitle({
              postSummary: post.summary,
              postText: post.text,
              description: row.description,
              fileName: row.fileName
            })
          : null,
      statusPath
    }
  })
}

/**
 * The signed-in actor's countable activities on one local day, oldest first,
 * one page at a time: the rows behind that day's calendar entry. Owner-only,
 * like its siblings, and bounded to a single day.
 *
 * Each row carries only what the day details render. `title` and
 * `statusPath` come from the post the activity was published as; when that
 * post is gone (deleting a status only clears `statusId`), was never made, or
 * is not the actor's own, both are `null` so the UI says the post is
 * unavailable rather than linking to nothing or naming it from another post.
 *
 * `nextOffset` counts activity rows, not posts, so a row without a post never
 * shifts the next page.
 */
export const GET = traceApiRoute(
  'getAccountFitnessCalendarDay',
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
    const parsed = FitnessCalendarDayQuery.safeParse(
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
      const { date, timeZone, startMs, endMs, limit, offset } = parsed.data
      const page = await database.getFitnessActivitiesInWindow({
        actorId: currentActor.id,
        startDate: startMs,
        endDate: endMs,
        limit,
        offset
      })
      const activities = await toDayActivities(
        database,
        currentActor.id,
        page.activities
      )
      const data: FitnessDayActivitiesPage = {
        date,
        timeZone,
        activities,
        hasMore: page.hasMore,
        nextOffset: offset + page.activities.length
      }
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data })
    } catch (error) {
      logger.error({
        message: 'Failed to load fitness calendar day',
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
