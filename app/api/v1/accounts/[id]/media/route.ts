import { z } from 'zod'

import { OptionalOAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { resolveActorIdParam } from '@/lib/services/mastodon/resolveClientId'
import { resolveActorStatusesAudience } from '@/lib/services/statusAccess'
import { Scope } from '@/lib/types/database/operations'
import { clampedLimit } from '@/lib/utils/clampedLimit'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_400,
  ERROR_404,
  ERROR_422,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

const MediaQueryParams = z.object({
  max_created_at: z.coerce.number().optional(),
  limit: clampedLimit(50, 25)
})

export const GET = traceApiRoute(
  'getAccountMedia',
  // Optional auth: the gallery is readable logged out, but who the viewer is
  // decides which attachments it may contain. This is the "Load more" behind
  // the profile page's Media tab, so an unscoped answer here would repopulate
  // the tab with the private attachments the page itself withholds.
  OptionalOAuthGuard<Params>(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req, context) => {
      const { database, currentActor, params } = context

      const { id: encodedAccountId } = await params
      if (!encodedAccountId) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })
      }
      const id = await resolveActorIdParam(database, encodedAccountId)

      const actor = await database.getActorFromId({ id })
      if (!actor) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      const url = new URL(req.url)
      const queryParams = Object.fromEntries(url.searchParams.entries())
      const parsedParams = MediaQueryParams.safeParse(queryParams)
      if (!parsedParams.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }

      const { limit, max_created_at: maxCreatedAt } = parsedParams.data

      // An attachment is exactly as readable as the status carrying it, so the
      // gallery is scoped by the same audience the account's timeline is.
      const audience = await resolveActorStatusesAudience({
        database,
        targetActor: actor,
        currentActor
      })

      const attachments = await database.getAttachmentsForActor({
        actorId: id,
        limit,
        maxCreatedAt,
        publicOnly: audience.publicOnly,
        visibleToActorId: audience.visibleToActorId,
        includeFollowersOnly: audience.includeFollowersOnly,
        followersAudience: audience.followersAudience
      })

      const host = headerHost(req.headers)
      // Percent-encoded: the router hands the id over already decoded, and the
      // resolver accepts a raw http(s) URI as an id form, so the raw value would
      // emit a Link URL that does not route back here.
      const pathBase = `/api/v1/accounts/${encodeURIComponent(encodedAccountId)}/media`

      const nextLink =
        attachments.length > 0
          ? `<https://${host}${pathBase}?limit=${limit}&max_created_at=${attachments[attachments.length - 1].createdAt}>; rel="next"`
          : null

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: attachments,
        additionalHeaders: [
          ...(nextLink ? [['Link', nextLink] as [string, string]] : [])
        ]
      })
    }
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { accountId: params?.id || 'unknown' }
    }
  }
)
