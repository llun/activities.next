import { z } from 'zod'

import { annotateMastodonStatusesWithFilters } from '@/lib/services/filters/applyFilters'
import {
  OptionalOAuthGuard,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getMastodonStatuses } from '@/lib/services/mastodon/getMastodonStatus'
import { getFilteredStatusPage } from '@/lib/services/timelines/getFilteredTimelinePage'
import {
  parseTimelineQuery,
  timelineErrorBoundary
} from '@/lib/services/timelines/request'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_400, apiResponse, defaultOptions } from '@/lib/utils/response'
import {
  isMastodonHashtagName,
  normalizeHashtagParam
} from '@/lib/utils/text/mastodonHashtag'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { urlToId } from '@/lib/utils/urlToId'

export const dynamic = 'force-dynamic'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const Params = z.object({
  hashtag: z.string().min(1).max(255)
})

interface RouteParams {
  hashtag: string
}

// Mastodon caps each of any[]/all[]/none[] at 4 additional tags
// (HashtagQueryService LIMIT_PER_MODE).
const TAGS_PER_MODE_LIMIT = 4

// Collect the repeated `key[]` (and bare `key`) query params as bare hashtag
// names. Returns null when any provided value is not a valid hashtag name so
// the caller can 400.
const parseAdditionalTags = (
  searchParams: URLSearchParams,
  key: 'any' | 'all' | 'none'
): string[] | null => {
  const values = [
    ...searchParams.getAll(`${key}[]`),
    ...searchParams.getAll(key)
  ]
  const tags = new Set<string>()
  for (const value of values) {
    const name = value.replace(/^#+/, '')
    // Bound the length like the primary hashtag (max 255) so an unbounded tag
    // name can't reach the DB query; then validate the Unicode alphabet.
    if (name.length > 255 || !isMastodonHashtagName(name)) return null
    // Dedupe so duplicate tags don't append redundant (esp. `all[]`) subqueries.
    tags.add(name)
  }
  return Array.from(tags).slice(0, TAGS_PER_MODE_LIMIT)
}

// https://docs.joinmastodon.org/methods/timelines/#tag
export const GET = traceApiRoute(
  'getHashtagTimeline',
  OptionalOAuthGuard<RouteParams>(
    [Scope.enum.read],
    timelineErrorBoundary(CORS_HEADERS, async (req, context) => {
      const { database, currentActor, params: routeParams } = context
      const badRequest = () =>
        apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })

      const parseResult = Params.safeParse(await routeParams)
      if (!parseResult.success) return badRequest()

      // The App Router hands path params over percent-encoded; decode and
      // validate against the Unicode hashtag alphabet (letters/numbers/_).
      const hashtag = normalizeHashtagParam(parseResult.data.hashtag)
      if (!hashtag) return badRequest()

      const url = new URL(req.url)
      const parsedQuery = parseTimelineQuery(url.searchParams)
      if (!parsedQuery.ok) return badRequest()

      const anyTags = parseAdditionalTags(url.searchParams, 'any')
      const allTags = parseAdditionalTags(url.searchParams, 'all')
      const noneTags = parseAdditionalTags(url.searchParams, 'none')
      if (anyTags === null || allTags === null || noneTags === null) {
        return badRequest()
      }

      const effectiveLimit = parsedQuery.query.limit
      const { local, remote, onlyMedia, maxStatusId } = parsedQuery.query
      // `min_id` and `since_id` both express a lower-bound cursor; collapse
      // them with `min_id`-wins precedence, matching the public timeline.
      const minStatusId =
        parsedQuery.query.minStatusId ?? parsedQuery.query.sinceStatusId

      const { statuses, nextMaxStatusId, prevMinStatusId, filterRecords } =
        await getFilteredStatusPage({
          database,
          actorId: currentActor?.id,
          maxStatusId,
          limit: effectiveLimit,
          // Hashtag pages use the public keyword-filter context: hide-filters
          // drop rows, warn-filters annotate. Applied unconditionally so
          // instance-wide server filters reach signed-out viewers too
          // (getActiveFilters returns only server filters when actorId is
          // undefined), per REVIEW.md's cross-view filtering invariant.
          filterContext: 'public',
          fetchBatch: ({ maxStatusId: cursor, limit }) =>
            database.getStatusesByHashtag({
              hashtag,
              limit,
              maxStatusId: cursor ?? undefined,
              minStatusId: minStatusId ?? undefined,
              onlyMedia,
              local: local && !remote,
              remote: remote && !local,
              anyTags,
              allTags,
              noneTags
            })
        })

      const host = headerHost(req.headers)
      const encodedTag = encodeURIComponent(hashtag)
      const linkBaseParams = new URLSearchParams()
      linkBaseParams.set('limit', `${effectiveLimit}`)
      for (const [mode, tags] of [
        ['any', anyTags],
        ['all', allTags],
        ['none', noneTags]
      ] as const) {
        for (const tag of tags) linkBaseParams.append(`${mode}[]`, tag)
      }
      if (local && !remote) linkBaseParams.set('local', 'true')
      if (remote && !local) linkBaseParams.set('remote', 'true')
      if (onlyMedia) linkBaseParams.set('only_media', 'true')
      const buildLink = (
        cursorName: 'max_id' | 'min_id',
        cursorValue: string
      ) => {
        const linkParams = new URLSearchParams(linkBaseParams)
        linkParams.set(cursorName, urlToId(cursorValue))
        const rel = cursorName === 'max_id' ? 'next' : 'prev'
        return `<https://${host}/api/v1/timelines/tag/${encodedTag}?${linkParams.toString()}>; rel="${rel}"`
      }
      const nextLink = nextMaxStatusId
        ? buildLink('max_id', nextMaxStatusId)
        : null
      const prevLink = prevMinStatusId
        ? buildLink('min_id', prevMinStatusId)
        : null
      const links = [nextLink, prevLink].filter(Boolean).join(', ')
      const mastodonStatuses = await getMastodonStatuses(
        database,
        statuses,
        currentActor?.id
      )
      const annotatedStatuses = annotateMastodonStatusesWithFilters(
        mastodonStatuses,
        statuses,
        filterRecords ?? []
      )

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: annotatedStatuses,
        additionalHeaders: [
          ...(links.length > 0 ? [['Link', links] as [string, string]] : [])
        ]
      })
    }),
    { errorResponse: corsErrorResponse(CORS_HEADERS) }
  ),
  {
    addAttributes: async (_req, context) => {
      const { hashtag } = await context.params
      return { hashtag }
    }
  }
)
