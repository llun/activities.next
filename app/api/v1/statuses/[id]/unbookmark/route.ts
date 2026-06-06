import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { getReadableStatus } from '@/lib/services/statusRouteAccess'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_404,
  ERROR_500,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const POST = traceApiRoute(
  'unbookmarkStatus',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:bookmarks']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const encodedStatusId = (await params).id
      if (!encodedStatusId)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })

      const statusId = idToUrl(encodedStatusId)
      const status = await getReadableStatus({
        database,
        statusId,
        currentActor,
        withReplies: false
      })
      if (!status) {
        // The status is not readable for the current actor (e.g. its visibility
        // changed after they bookmarked it). Mastodon still lets the owner of
        // the bookmark remove it and returns the Status with `bookmarked: false`,
        // rather than a 404, as long as the underlying status still exists.
        const isBookmarked = await database.isActorBookmarkedStatus({
          actorId: currentActor.id,
          statusId
        })
        if (!isBookmarked)
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: ERROR_404,
            responseStatusCode: 404
          })

        await database.deleteBookmark({ actorId: currentActor.id, statusId })

        // Build the entity directly from storage, bypassing the visibility
        // filter, so the response carries the real Status shape with the
        // now-cleared bookmark flag.
        const unreadableStatus = await database.getStatus({
          statusId,
          withReplies: false,
          currentActorId: currentActor.id
        })
        if (!unreadableStatus)
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: ERROR_404,
            responseStatusCode: 404
          })

        const unreadableMastodonStatus = await getMastodonStatus(
          database,
          unreadableStatus,
          currentActor.id
        )
        if (!unreadableMastodonStatus)
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: ERROR_500,
            responseStatusCode: 500
          })

        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: unreadableMastodonStatus
        })
      }

      await database.deleteBookmark({ actorId: currentActor.id, statusId })

      const updatedStatus = await database.getStatus({
        statusId,
        withReplies: false,
        currentActorId: currentActor.id
      })
      if (!updatedStatus)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_500,
          responseStatusCode: 500
        })

      const mastodonStatus = await getMastodonStatus(
        database,
        updatedStatus,
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
    }
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { statusId: params?.id || 'unknown' }
    }
  }
)
