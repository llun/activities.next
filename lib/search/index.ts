import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { Status } from '@/lib/types/domain/status'
import * as Mastodon from '@/lib/types/mastodon'
import { logger } from '@/lib/utils/logger'

import { searchMeilisearch } from './meilisearch'
import { resolveAccountForSearch } from './resolveAccount'
import { resolveStatusForSearch } from './resolveStatus'

type SearchParams = {
  database: Database
  query: string
  limit: number
  offset: number
  currentActorId?: string
  includeAccounts: boolean
  includeStatuses: boolean
  includeHashtags: boolean
  accountId?: string
  following?: boolean
  minStatusId?: string
  maxStatusId?: string
  resolve?: boolean
  // Accepted for Mastodon compatibility; this project has no tag review state.
  excludeUnreviewed?: boolean
}

type SearchResult = {
  accounts: Mastodon.Account[]
  statuses: Status[]
  hashtags: Mastodon.SearchTag[]
}

const emptySearchResult = (): SearchResult => ({
  accounts: [],
  statuses: [],
  hashtags: []
})

const addResolvedStatus = (
  result: SearchResult,
  resolvedStatus: Status | null,
  limit: number
): SearchResult =>
  resolvedStatus
    ? {
        ...result,
        statuses: [
          resolvedStatus,
          ...result.statuses.filter((status) => status.id !== resolvedStatus.id)
        ].slice(0, limit)
      }
    : result

const canUseMeilisearch = ({
  following,
  accountId,
  minStatusId,
  maxStatusId,
  resolve
}: SearchParams) =>
  !following && !accountId && !minStatusId && !maxStatusId && !resolve

const hydrateAccounts = (database: Database, actorIds: string[]) =>
  database.getMastodonActorsFromIds({ ids: actorIds })

const searchDatabase = async ({
  database,
  query,
  limit,
  offset,
  currentActorId,
  includeAccounts,
  includeStatuses,
  includeHashtags,
  accountId,
  following,
  minStatusId,
  maxStatusId,
  resolve
}: SearchParams): Promise<SearchResult> => {
  const [accounts, statuses, hashtags] = await Promise.all([
    includeAccounts
      ? database.searchAccounts({
          query,
          limit,
          offset,
          currentActorId,
          following,
          resolve
        })
      : Promise.resolve([]),
    includeStatuses
      ? database.searchStatuses({
          query,
          limit,
          offset,
          currentActorId,
          accountId,
          minStatusId,
          maxStatusId
        })
      : Promise.resolve([]),
    includeHashtags
      ? database.searchHashtags({ query, limit, offset })
      : Promise.resolve([])
  ])

  return { accounts, statuses, hashtags }
}

const searchWithMeilisearch = async (
  params: SearchParams
): Promise<SearchResult> => {
  const { database, query, limit, offset, includeAccounts, includeStatuses } =
    params
  const { includeHashtags } = params
  const config = getConfig().search

  if (config.backend !== 'meilisearch') {
    return searchDatabase(params)
  }

  const [accountIds, statusIds, hashtagIds] = await Promise.all([
    includeAccounts
      ? searchMeilisearch({
          config,
          type: 'accounts',
          query,
          limit,
          offset
        })
      : Promise.resolve([]),
    includeStatuses
      ? searchMeilisearch({
          config,
          type: 'statuses',
          query,
          limit,
          offset
        })
      : Promise.resolve([]),
    includeHashtags
      ? searchMeilisearch({
          config,
          type: 'hashtags',
          query,
          limit,
          offset
        })
      : Promise.resolve([])
  ])

  const [accounts, statuses, hashtags] = await Promise.all([
    hydrateAccounts(database, accountIds),
    database.getStatusesByIds({
      statusIds,
      currentActorId: params.currentActorId,
      visibleToActorId: params.currentActorId
    }),
    database.getSearchHashtagsByIds({ hashtagIds })
  ])

  return { accounts, statuses, hashtags }
}

export const search = async (params: SearchParams): Promise<SearchResult> => {
  if (!params.query.trim()) return emptySearchResult()

  // params.excludeUnreviewed is intentionally ignored: no reviewed/unreviewed
  // tag state exists in this implementation.

  const [resolvedStatus] = await Promise.all([
    params.includeStatuses && params.resolve && params.offset === 0
      ? resolveStatusForSearch({
          database: params.database,
          query: params.query
        })
      : Promise.resolve(null),
    params.includeAccounts && params.resolve && params.offset === 0
      ? resolveAccountForSearch({
          database: params.database,
          query: params.query
        })
      : Promise.resolve(null)
  ])

  const config = getConfig().search
  if (config.backend !== 'meilisearch' || !canUseMeilisearch(params)) {
    return addResolvedStatus(
      await searchDatabase(params),
      resolvedStatus,
      params.limit
    )
  }

  try {
    return addResolvedStatus(
      await searchWithMeilisearch(params),
      resolvedStatus,
      params.limit
    )
  } catch (error) {
    logger.warn({
      message: 'Meilisearch search failed; falling back to database search',
      error: error instanceof Error ? error.message : String(error)
    })
    return addResolvedStatus(
      await searchDatabase(params),
      resolvedStatus,
      params.limit
    )
  }
}
