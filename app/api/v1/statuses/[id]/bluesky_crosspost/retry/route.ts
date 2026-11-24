import { CROSSPOST_BLUESKY_JOB_NAME } from '@/lib/jobs/names'
import { BLUESKY_CROSSPOST_FAILED_MESSAGE } from '@/lib/services/bluesky/crosspost'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { resolveStatusIdParam } from '@/lib/services/mastodon/resolveClientId'
import { refetchedStatusResponse } from '@/lib/services/mastodon/statusActionResponse'
import { getQueue } from '@/lib/services/queue'
import { Scope } from '@/lib/types/database/operations'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import { apiCorsError, apiResponse, defaultOptions } from '@/lib/utils/response'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

// POST /api/v1/statuses/:id/bluesky_crosspost/retry — puts the owner's failed
// Bluesky cross-post back to pending and queues it again.
export const POST = traceApiRoute(
  'retryBlueskyCrosspost',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:statuses']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const encodedStatusId = (await params).id
      if (!encodedStatusId) return apiCorsError(req, CORS_HEADERS, 404)

      const statusId = await resolveStatusIdParam(database, encodedStatusId)
      const status = await database.getStatus({ statusId, withReplies: false })
      // Someone else's post answers as missing: its cross-post is not theirs.
      if (!status || status.actorId !== currentActor.id) {
        return apiCorsError(req, CORS_HEADERS, 404)
      }

      const crosspost = await database.getBlueskyCrosspost({ statusId })
      if (!(await database.resetBlueskyCrosspostForRetry({ statusId }))) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'This post has no failed Bluesky copy to retry.' },
          responseStatusCode: 422
        })
      }

      try {
        // A fresh id per retry, so the first job's id does not dedupe it away;
        // the job itself posts only a row that is still pending.
        await getQueue().publish({
          id: getHashFromString(
            `${statusId}#bluesky-crosspost#retry-${Date.now()}`
          ),
          name: CROSSPOST_BLUESKY_JOB_NAME,
          data: { statusId }
        })
      } catch (error) {
        logger.error({
          message: 'Failed to queue a Bluesky cross-post retry',
          statusId,
          err: toLoggableError(error)
        })
        await database.markBlueskyCrosspostFailed({
          statusId,
          error: crosspost?.error ?? BLUESKY_CROSSPOST_FAILED_MESSAGE
        })
        return apiCorsError(req, CORS_HEADERS, 500)
      }

      return refetchedStatusResponse({
        req,
        database,
        currentActor,
        statusId,
        allowedMethods: CORS_HEADERS
      })
    }
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { statusId: params?.id || 'unknown' }
    }
  }
)
