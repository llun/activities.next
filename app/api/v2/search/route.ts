import { NextRequest } from 'next/server'
import { z } from 'zod'

import { recordActorIfNeeded } from '@/lib/actions/utils'
import { getRemoteStatus } from '@/lib/activities/getRemoteStatus'
import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import { getConfig } from '@/lib/config'
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
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'
import { Tag } from '@/lib/types/mastodon/tag'
import { parseAccountHandle } from '@/lib/utils/accountHandle'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { logger } from '@/lib/utils/logger'
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

const FALSE_VALUES = new Set(['false', '0', 'f', 'no', 'n', 'off'])

const BooleanParam = z.string().transform((value) => {
  const normalized = value.trim().toLowerCase()
  if (normalized.length === 0) return undefined
  if (FALSE_VALUES.has(normalized)) return false
  return true
})

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

const getQueryParams = (req: NextRequest) =>
  Object.fromEntries(new URL(req.url).searchParams)

const isUrl = (value: string) => {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'https:' || protocol === 'http:'
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

const normalizeLookupId = (value?: string | null) => normalizeUrlId(value) ?? ''

const getProfileUrlAccountHandle = (query: string) => {
  try {
    const url = new URL(query)
    const match = /^\/@([^/]+)\/?$/.exec(url.pathname)
    if (!match) return null

    const profileHandle = decodeURIComponent(match[1])
    const handle = profileHandle.includes('@')
      ? `@${profileHandle.replace(/^@/, '')}`
      : `@${profileHandle}@${url.hostname}`
    return parseAccountHandle(handle)
  } catch {
    return null
  }
}

const getCanonicalAccountActorId = async (query: string) => {
  const handle = getProfileUrlAccountHandle(query)
  if (!handle) return query

  return (
    (await getWebfingerSelf({
      account: `${handle.username}@${handle.domain}`
    })) ?? query
  )
}

const recordResolvedActorIfNeeded = async ({
  actorId,
  database,
  signingActor
}: {
  actorId: string
  database: Database
  signingActor?: Actor
}) => {
  try {
    return (
      (await recordActorIfNeeded({
        actorId,
        database,
        signingActor
      })) ?? null
    )
  } catch (err) {
    logger.warn({
      message: 'Failed to record resolved search actor',
      actorId,
      err
    })
    return null
  }
}

const orderAccountsByIds = ({
  accounts,
  ids
}: {
  accounts: MastodonAccount[]
  ids: string[]
}) => {
  const accountsByLookupId = new Map<string, MastodonAccount>()

  for (const account of accounts) {
    for (const key of [account.id, account.url]) {
      const lookupId = normalizeLookupId(key)
      if (lookupId) accountsByLookupId.set(lookupId, account)
    }
  }

  return ids
    .map((id) => accountsByLookupId.get(normalizeLookupId(id)))
    .filter((account): account is MastodonAccount => Boolean(account))
}

const getStatusLookupIds = (status: Status) => {
  const ids = [status.id]
  if ('url' in status && typeof status.url === 'string') ids.push(status.url)
  return ids
}

const orderStatusesByIds = ({
  statuses,
  ids
}: {
  statuses: Status[]
  ids: string[]
}) => {
  const statusesByLookupId = new Map<string, Status>()

  for (const status of statuses) {
    for (const key of getStatusLookupIds(status)) {
      const lookupId = normalizeLookupId(key)
      if (lookupId) statusesByLookupId.set(lookupId, status)
    }
  }

  return ids
    .map((id) => statusesByLookupId.get(normalizeLookupId(id)))
    .filter((status): status is Status => Boolean(status))
}

const canIncludeAccount = async ({
  database,
  actorId,
  currentActor,
  following
}: {
  database: Database
  actorId: string
  currentActor: Actor | null
  following: boolean
}) => {
  if (!following) return true
  if (!currentActor) return false

  return database.isCurrentActorFollowing({
    currentActorId: currentActor.id,
    followingActorId: actorId
  })
}

const resolveAccountId = async ({
  database,
  currentActor,
  query,
  resolve,
  following
}: {
  database: Database
  currentActor: Actor | null
  query: string
  resolve: boolean
  following: boolean
}) => {
  if (!resolve) return null

  if (isUrl(query)) {
    const existingActor = await database.getActorFromId({ id: query })
    const canonicalActorId = existingActor
      ? query
      : await getCanonicalAccountActorId(query)
    const actor =
      existingActor ??
      (canonicalActorId === query
        ? null
        : await database.getActorFromId({ id: canonicalActorId })) ??
      (await recordResolvedActorIfNeeded({
        actorId: canonicalActorId,
        database,
        signingActor: currentActor ?? undefined
      }))
    if (
      actor &&
      (await canIncludeAccount({
        database,
        actorId: actor.id,
        currentActor,
        following
      }))
    ) {
      return actor.id
    }
    return null
  }

  const handle = query.includes('@')
    ? parseAccountHandle(query)
    : { username: query, domain: getConfig().host }
  if (!handle) return null

  let actor = await database.getActorFromUsername(handle)
  if (!actor && query.includes('@')) {
    const actorId = await getWebfingerSelf({
      account: `${handle.username}@${handle.domain}`
    })
    actor = actorId
      ? await recordResolvedActorIfNeeded({
          actorId,
          database,
          signingActor: currentActor ?? undefined
        })
      : null
  }

  if (
    actor &&
    (await canIncludeAccount({
      database,
      actorId: actor.id,
      currentActor,
      following
    }))
  ) {
    return actor.id
  }

  return null
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
  if (!resolve || !isUrl(query)) return null

  const localStatus =
    (await database.getStatus({
      statusId: query,
      currentActorId: currentActor.id
    })) ?? (await database.getStatusFromUrl({ url: query }))

  const status =
    localStatus ??
    (await getRemoteStatus({
      statusId: query,
      signingActor: currentActor
    }))

  if (!status) return null

  if (!localStatus) {
    const actor = await recordResolvedActorIfNeeded({
      actorId: status.actorId,
      database,
      signingActor: currentActor
    })
    if (!actor) return null
  }

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
  const [resolvedAccountId, indexedIds] = await Promise.all([
    offset === 0
      ? resolveAccountId({
          database,
          currentActor,
          query,
          resolve: params.resolve ?? false,
          following: params.following ?? false
        })
      : Promise.resolve(null),
    database.searchAccountIds({
      q: query,
      limit,
      offset,
      ...(params.following && currentActor
        ? { followingActorId: currentActor.id }
        : {})
    })
  ])
  const ids = dedupeStrings(
    [resolvedAccountId, ...indexedIds].filter(
      (id): id is string => typeof id === 'string'
    )
  ).slice(0, limit)

  const accounts = await database.getMastodonActorsFromIds({ ids })
  return orderAccountsByIds({ accounts, ids })
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

  return hashtags.flatMap((hashtag) => {
    const parsed = Tag.safeParse(hashtag)
    return parsed.success ? [parsed.data] : []
  })
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
    offset === 0
      ? getResolvedStatus({
          database,
          currentActor,
          query,
          resolve: params.resolve ?? false
        })
      : Promise.resolve(null),
    database.searchStatusIds({
      q: query,
      limit,
      offset,
      currentActorId: currentActor.id,
      currentActorUsername: currentActor.username,
      currentActorDomain: currentActor.domain,
      accountId: normalizeUrlId(params.account_id),
      maxId: normalizeUrlId(params.max_id),
      minId: normalizeUrlId(params.min_id)
    })
  ])

  const resolvedStatusId = normalizeLookupId(resolvedStatus?.id)
  const ids = dedupeStrings(
    indexedIds.filter((id): id is string => typeof id === 'string')
  )
    .filter((id) => normalizeLookupId(id) !== resolvedStatusId)
    .slice(0, resolvedStatus ? limit - 1 : limit)
  const statuses = await database.getStatusesByIds({
    statusIds: ids,
    currentActorId: currentActor.id,
    visibleToActorId: currentActor.id
  })
  const orderedStatuses = orderStatusesByIds({
    statuses,
    ids
  })
  return getMastodonStatuses(
    database,
    [resolvedStatus, ...orderedStatuses].filter((status): status is Status =>
      Boolean(status)
    ),
    currentActor.id
  )
}

const requiresAuthentication = ({ params }: { params: ParsedSearchParams }) =>
  params.type === 'statuses' ||
  params.resolve === true ||
  params.following === true ||
  (params.type !== undefined &&
    params.offset !== undefined &&
    params.offset > 0)

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
      const offset = params.type ? (params.offset ?? 0) : 0

      if (!currentActor && requiresAuthentication({ params })) {
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
