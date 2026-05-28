import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import {
  annotateMastodonStatusesWithFilters,
  dropHideMatchesFromStatuses,
  getActiveFilters
} from '@/lib/services/filters/applyFilters'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getMastodonStatuses } from '@/lib/services/mastodon/getMastodonStatus'
import { TimelineFormat } from '@/lib/services/timelines/const'
import { normalizeTimelineLimit } from '@/lib/services/timelines/getFilteredTimelinePage'
import { Scope } from '@/lib/types/database/operations'
import { cleanJson } from '@/lib/utils/cleanJson'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl, urlToId } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const GET = traceApiRoute(
  'getConversationStatuses',
  OAuthGuardAnyScope<Params>(
    [
      Scope.enum.read,
      Scope.enum['read:conversations'],
      Scope.enum['read:statuses']
    ],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const url = new URL(req.url)
      const limit = normalizeTimelineLimit(
        parseInt(url.searchParams.get('limit') || `${PER_PAGE_LIMIT}`, 10)
      )
      const minStatusIdParam =
        url.searchParams.get('since_id') || url.searchParams.get('min_id')
      const maxStatusIdParam = url.searchParams.get('max_id')
      const minStatusId = minStatusIdParam ? idToUrl(minStatusIdParam) : null
      const maxStatusId = maxStatusIdParam ? idToUrl(maxStatusIdParam) : null
      const filterRecords = await getActiveFilters(
        database,
        currentActor.id,
        'home'
      )

      // Backfill loop: when hide filters drop rows we re-query past the last
      // scanned id until we either fill the requested page (with a peek row
      // so we can advertise next), exhaust the conversation, or hit the
      // iteration cap.
      type ConversationStatus = Awaited<
        ReturnType<typeof database.getDirectConversationStatuses>
      >[number]
      const MAX_BACKFILL_ITERATIONS = 5
      const visibleStatuses: ConversationStatus[] = []
      let cursor: string | null = maxStatusId
      let exhausted = false
      let lastScannedStatusId: string | null = null

      for (
        let iteration = 0;
        visibleStatuses.length <= limit && iteration < MAX_BACKFILL_ITERATIONS;
        iteration++
      ) {
        const batch = await database.getDirectConversationStatuses({
          actorId: currentActor.id,
          conversationId: id,
          limit: limit + 1,
          minStatusId,
          maxStatusId: cursor
        })
        if (batch.length === 0) {
          exhausted = true
          break
        }
        const filtered = dropHideMatchesFromStatuses(batch, filterRecords)
        visibleStatuses.push(...filtered)
        cursor = batch[batch.length - 1].id
        lastScannedStatusId = cursor
        if (batch.length < limit + 1) {
          exhausted = true
          break
        }
      }

      const hasMoreStatuses = visibleStatuses.length > limit
      const statuses = visibleStatuses.slice(0, limit)
      let nextMaxStatusId: string | null = null
      if (hasMoreStatuses && statuses.length > 0) {
        nextMaxStatusId = statuses[statuses.length - 1].id
      } else if (!exhausted && lastScannedStatusId) {
        nextMaxStatusId = lastScannedStatusId
      }
      const prevMinStatusId = statuses.length > 0 ? statuses[0].id : null

      if (
        url.searchParams.get('format') === TimelineFormat.enum.activities_next
      ) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: {
            statuses: statuses.map((status) => cleanJson(status)),
            nextMaxStatusId
          }
        })
      }

      const host = headerHost(req.headers)
      const nextLink = nextMaxStatusId
        ? `<https://${host}/api/v1/conversations/${id}/statuses?limit=${limit}&max_id=${urlToId(nextMaxStatusId)}>; rel="next"`
        : null
      const prevLink = prevMinStatusId
        ? `<https://${host}/api/v1/conversations/${id}/statuses?limit=${limit}&min_id=${urlToId(prevMinStatusId)}>; rel="prev"`
        : null
      const links = [nextLink, prevLink].filter(Boolean).join(', ')
      const mastodonStatuses = await getMastodonStatuses(
        database,
        statuses,
        currentActor.id
      )
      const annotatedStatuses = annotateMastodonStatusesWithFilters(
        mastodonStatuses,
        statuses,
        filterRecords
      )

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: annotatedStatuses,
        additionalHeaders: [
          ...(links.length > 0 ? [['Link', links] as [string, string]] : [])
        ]
      })
    }
  )
)
