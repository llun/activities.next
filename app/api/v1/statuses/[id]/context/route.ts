import {
  annotateMastodonStatusesWithFilters,
  getActiveFilters
} from '@/lib/services/filters/applyFilters'
import { OptionalOAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { getMastodonStatuses } from '@/lib/services/mastodon/getMastodonStatus'
import { getStatusContext } from '@/lib/services/statuses/getStatusContext'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_404,
  apiCorsError,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const GET = traceApiRoute(
  'getStatusContext',
  OptionalOAuthGuard<Params>(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req, context) => {
      const { params } = context
      const encodedStatusId = (await params).id
      if (!encodedStatusId) return apiCorsError(req, CORS_HEADERS, 404)

      const { database, currentActor } = context

      const {
        status,
        ancestors: ancestorStatuses,
        descendants: descendantStatuses
      } = await getStatusContext({
        database,
        statusId: encodedStatusId,
        currentActor
      })

      if (!status) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      const [ancestors, descendants] = await Promise.all([
        getMastodonStatuses(database, ancestorStatuses, currentActor?.id),
        getMastodonStatuses(database, descendantStatuses, currentActor?.id)
      ])

      // Mastodon annotates the `filtered` field on context reads using the
      // `thread` filter context. Per-account filters are skipped for
      // unauthenticated requests, but instance-wide server filters still apply
      // to anonymous viewers (see getActiveFilters).
      const filterRecords = await getActiveFilters(
        database,
        currentActor?.id,
        'thread'
      )
      const annotatedAncestors = annotateMastodonStatusesWithFilters(
        ancestors,
        ancestorStatuses,
        filterRecords
      )
      const annotatedDescendants = annotateMastodonStatusesWithFilters(
        descendants,
        descendantStatuses,
        filterRecords
      )

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {
          ancestors: annotatedAncestors,
          descendants: annotatedDescendants
        }
      })
    },
    // A token scoped read:statuses OR read satisfies the requirement.
    { matchMode: 'any' }
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { statusId: params?.id || 'unknown' }
    }
  }
)
