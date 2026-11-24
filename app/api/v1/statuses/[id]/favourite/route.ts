import { sendLike } from '@/lib/activities'
import {
  blueskyInteractionFailure,
  likeBlueskyPost
} from '@/lib/services/bluesky/interactions'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { resolveStatusIdParam } from '@/lib/services/mastodon/resolveClientId'
import { refetchedStatusResponse } from '@/lib/services/mastodon/statusActionResponse'
import { getReadableStatusForAction } from '@/lib/services/statuses/getReadableStatusForAction'
import { Scope } from '@/lib/types/database/operations'
import { getOriginalStatus, isBlueskyStatus } from '@/lib/types/domain/status'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiCorsError, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const POST = traceApiRoute(
  'favouriteStatus',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:favourites']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const encodedStatusId = (await params).id
      if (!encodedStatusId) return apiCorsError(req, CORS_HEADERS, 404)

      const statusId = await resolveStatusIdParam(database, encodedStatusId)
      const status = await getReadableStatusForAction({
        database,
        statusId,
        currentActor,
        withReplies: false
      })
      if (!status) return apiCorsError(req, CORS_HEADERS, 404)
      if (isBlueskyStatus(status)) {
        try {
          await likeBlueskyPost(
            database,
            currentActor,
            getOriginalStatus(status).id
          )
        } catch (error) {
          const failure = blueskyInteractionFailure(error)
          if (!failure) throw error
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: { error: failure.error },
            responseStatusCode: failure.status
          })
        }
        return refetchedStatusResponse({
          req,
          database,
          currentActor,
          statusId: status.id,
          allowedMethods: CORS_HEADERS
        })
      }

      // The write decides whether this is a new like, so a repeat or a
      // concurrent unfavourite never leaves the remote out of step.
      const created = await database.createLike({
        actorId: currentActor.id,
        statusId: status.id
      })
      if (created) await sendLike({ currentActor, status })

      // Refetch status to get updated counts
      return refetchedStatusResponse({
        req,
        database,
        currentActor,
        statusId: status.id,
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
