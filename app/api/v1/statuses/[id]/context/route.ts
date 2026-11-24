import { loadBlueskyThread } from '@/lib/services/bluesky/thread'
import {
  annotateMastodonStatusesWithFilters,
  getActiveFilters
} from '@/lib/services/filters/applyFilters'
import { OptionalOAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { getMastodonStatuses } from '@/lib/services/mastodon/getMastodonStatus'
import { resolveStatusIdParam } from '@/lib/services/mastodon/resolveClientId'
import { getStatusContext } from '@/lib/services/statuses/getStatusContext'
import { queueThreadGapBackfill } from '@/lib/services/statuses/parentBackfill'
import { Scope } from '@/lib/types/database/operations'
import { isBlueskyId } from '@/lib/utils/blueskyId'
import { HttpMethod } from '@/lib/utils/http-headers'
import { isPublicId } from '@/lib/utils/publicId'
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

      let contextStatusId = encodedStatusId
      if (currentActor) {
        const resolvedStatusId = await resolveStatusIdParam(
          database,
          encodedStatusId
        )
        if (isBlueskyId(resolvedStatusId)) {
          await loadBlueskyThread(database, currentActor, resolvedStatusId)
        }
        // Reuse the resolved canonical URI when a publicId resolved, so
        // getStatusContext does not repeat the publicId lookup for fediverse
        // or Bluesky statuses. Keep the original param otherwise so legacy
        // raw-id fallbacks stay intact.
        if (
          isPublicId(encodedStatusId) &&
          resolvedStatusId !== encodedStatusId
        ) {
          contextStatusId = resolvedStatusId
        }
      }

      const {
        status,
        ancestors: ancestorStatuses,
        descendants: descendantStatuses,
        missingParentId
      } = await getStatusContext({
        database,
        statusId: contextStatusId,
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

      // A signed-in read whose thread stops at a parent this instance does
      // not have queues that parent's fetch, as Mastodon fetches a thread for
      // a signed-in context read. Anonymous reads queue nothing, and a parent
      // is queued once per cooldown (queueMissingParentFetch).
      if (currentActor) {
        await queueThreadGapBackfill({ database, missingParentId })
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
