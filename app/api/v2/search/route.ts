import { NextRequest } from 'next/server'
import { z } from 'zod'

import { Database } from '@/lib/database/types'
import {
  OptionalOAuthGuard,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { getMastodonStatuses } from '@/lib/services/mastodon/getMastodonStatus'
import { canActorReadStatus } from '@/lib/services/statusAccess'
import { Scope } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
import { Tag } from '@/lib/types/mastodon/tag'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  ERROR_400,
  ERROR_401,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

type RouteParams = Record<string, never>

type SearchType = 'accounts' | 'statuses' | 'hashtags'

const SearchTypeParam = z
  .enum(['account', 'accounts', 'status', 'statuses', 'hashtag', 'hashtags'])
  .transform((value): SearchType => {
    if (value === 'account') return 'accounts'
    if (value === 'status') return 'statuses'
    if (value === 'hashtag') return 'hashtags'
    return value
  })

const BooleanParam = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')

const SearchParams = z.object({
  q: z.string(),
  type: SearchTypeParam.optional(),
  resolve: BooleanParam.optional(),
  following: BooleanParam.optional(),
  exclude_unreviewed: BooleanParam.optional(),
  account_id: z.string().optional(),
  max_id: z.string().optional(),
  min_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(40).optional(),
  offset: z.coerce.number().int().min(0).optional()
})

type ParsedSearchParams = z.infer<typeof SearchParams>

const emptySearchResult = {
  accounts: [],
  statuses: [],
  hashtags: []
}

const getQueryParams = (req: NextRequest) => {
  const url = new URL(req.url)
  const queryParams: Record<string, string> = {}
  url.searchParams.forEach((value, key) => {
    queryParams[key] = value
  })
  return queryParams
}

const isHttpsUrl = (value: string) => {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

const normalizeUrlId = (value?: string | null) => {
  if (!value) return null
  if (value.startsWith('https://') || value.startsWith('http://')) return value
  return idToUrl(value)
}

const dedupeStrings = (values: string[]) => [...new Set(values)]

const resolveAccountId = async ({
  database,
  query,
  resolve
}: {
  database: Database
  query: string
  resolve: boolean
}) => {
  if (!resolve || !isHttpsUrl(query)) return null

  const actor = await database.getActorFromId({ id: query })
  return actor?.id ?? null
}

const getResolvedStatus = async ({
  database,
  currentActor,
  query,
  resolve
}: {
  database: Database
  currentActor: Actor
  query: string
  resolve: boolean
}) => {
  if (!resolve || !isHttpsUrl(query)) return null

  const status =
    (await database.getStatus({
      statusId: query,
      currentActorId: currentActor.id
    })) ?? (await database.getStatusFromUrl({ url: query }))

  if (!status) return null

  const canRead = await canActorReadStatus({
    database,
    status,
    currentActor
  })
  return canRead ? status : null
}

const searchAccounts = async ({
  database,
  currentActor,
  params,
  query,
  limit,
  offset
}: {
  database: Database
  currentActor: Actor | null
  params: ParsedSearchParams
  query: string
  limit: number
  offset: number
}) => {
  const resolvedAccountId = await resolveAccountId({
    database,
    query,
    resolve: params.resolve ?? false
  })
  const indexedIds = await database.searchAccountIds({
    q: query,
    limit,
    offset,
    ...(params.following && currentActor
      ? { followingActorId: currentActor.id }
      : {})
  })
  const ids = dedupeStrings(
    [resolvedAccountId, ...indexedIds].filter(
      (id): id is string => typeof id === 'string'
    )
  ).slice(0, limit)

  return database.getMastodonActorsFromIds({ ids })
}

const searchHashtags = async ({
  database,
  params,
  query,
  limit,
  offset
}: {
  database: Database
  params: ParsedSearchParams
  query: string
  limit: number
  offset: number
}) => {
  const hashtags = await database.searchHashtags({
    q: query,
    limit,
    offset,
    excludeUnreviewed: params.exclude_unreviewed ?? false
  })

  return hashtags.map((hashtag) => Tag.parse(hashtag))
}

const searchStatuses = async ({
  database,
  currentActor,
  params,
  query,
  limit,
  offset
}: {
  database: Database
  currentActor: Actor
  params: ParsedSearchParams
  query: string
  limit: number
  offset: number
}) => {
  const [resolvedStatus, indexedIds] = await Promise.all([
    getResolvedStatus({
      database,
      currentActor,
      query,
      resolve: params.resolve ?? false
    }),
    database.searchStatusIds({
      q: query,
      limit,
      offset,
      currentActorId: currentActor.id,
      accountId: normalizeUrlId(params.account_id),
      maxId: normalizeUrlId(params.max_id),
      minId: normalizeUrlId(params.min_id)
    })
  ])

  const ids = dedupeStrings(
    [resolvedStatus?.id, ...indexedIds].filter(
      (id): id is string => typeof id === 'string'
    )
  ).slice(0, limit)
  const statuses = await database.getStatusesByIds({
    statusIds: ids,
    currentActorId: currentActor.id,
    visibleToActorId: currentActor.id
  })
  return getMastodonStatuses(database, statuses as Status[], currentActor.id)
}

const requiresAuthentication = ({
  params,
  offset
}: {
  params: ParsedSearchParams
  offset: number
}) =>
  params.type === 'statuses' ||
  params.resolve === true ||
  params.following === true ||
  Boolean(params.account_id) ||
  offset > 0

export const GET = traceApiRoute(
  'search',
  OptionalOAuthGuard<RouteParams>(
    [Scope.enum['read:search']],
    async (req, context) => {
      const parsedParams = SearchParams.safeParse(getQueryParams(req))
      if (!parsedParams.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })
      }

      const { database, currentActor } = context
      const params = parsedParams.data
      const query = params.q.trim()
      const limit = params.limit ?? 20
      const offset = params.offset ?? 0

      if (!currentActor && requiresAuthentication({ params, offset })) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_401,
          responseStatusCode: 401
        })
      }

      if (query.length === 0) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: emptySearchResult
        })
      }

      const includeAccounts = !params.type || params.type === 'accounts'
      const includeHashtags = !params.type || params.type === 'hashtags'
      const includeStatuses =
        Boolean(currentActor) && (!params.type || params.type === 'statuses')

      const [accounts, hashtags, statuses] = await Promise.all([
        includeAccounts
          ? searchAccounts({
              database,
              currentActor,
              params,
              query,
              limit,
              offset
            })
          : [],
        includeHashtags
          ? searchHashtags({
              database,
              params,
              query,
              limit,
              offset
            })
          : [],
        includeStatuses && currentActor
          ? searchStatuses({
              database,
              currentActor,
              params,
              query,
              limit,
              offset
            })
          : []
      ])

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {
          accounts,
          statuses,
          hashtags
        }
      })
    },
    { errorResponse: corsErrorResponse(CORS_HEADERS) }
  )
)
