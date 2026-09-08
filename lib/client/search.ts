import type { Status } from '@/lib/types/domain/status'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'
import type { Tag } from '@/lib/types/mastodon/tag'

export type SearchType = 'accounts' | 'statuses' | 'hashtags'

export interface SearchResult<TStatus = Status> {
  accounts: MastodonAccount[]
  statuses: TStatus[]
  hashtags: Tag[]
}

export interface SearchParams {
  q: string
  type?: SearchType
  limit?: number
  offset?: number
  resolve?: boolean
  signal?: AbortSignal
}

export interface SearchAccountsParams {
  q: string
  limit?: number
  resolve?: boolean
  signal?: AbortSignal
}

const emptySearchResult = (): SearchResult => ({
  accounts: [],
  statuses: [],
  hashtags: []
})

const MAX_SEARCH_ERROR_DETAIL_LENGTH = 200

const truncateSearchErrorDetail = (detail: string) =>
  detail.length > MAX_SEARCH_ERROR_DETAIL_LENGTH
    ? `${detail.slice(0, MAX_SEARCH_ERROR_DETAIL_LENGTH)}...`
    : detail

const getSearchResponseErrorMessage = (response: Response, text: string) => {
  let detail = text || response.statusText

  try {
    const data = JSON.parse(text) as Record<string, unknown>
    detail =
      typeof data.message === 'string'
        ? data.message
        : typeof data.error === 'string'
          ? data.error
          : typeof data.status === 'string'
            ? data.status
            : detail
  } catch {
    // Keep the raw response text for non-JSON failures.
  }

  detail = truncateSearchErrorDetail(detail)
  return `Search request failed (${response.status})${detail ? `: ${detail}` : ''}`
}

export const search = async ({
  q,
  type,
  limit,
  offset,
  resolve = true,
  signal
}: SearchParams): Promise<SearchResult> => {
  const params = new URLSearchParams({
    q,
    resolve: resolve ? 'true' : 'false',
    format: 'activities_next'
  })
  if (type) params.set('type', type)
  if (limit !== undefined) params.set('limit', `${limit}`)
  if (offset !== undefined) params.set('offset', `${offset}`)

  const response = await fetch(`/api/v2/search?${params.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(getSearchResponseErrorMessage(response, text))
  }
  try {
    return JSON.parse(text) as SearchResult
  } catch {
    return emptySearchResult()
  }
}

export const searchAccounts = async ({
  q,
  limit = 5,
  resolve = true,
  signal
}: SearchAccountsParams): Promise<MastodonAccount[]> => {
  const url = new URL(`${window.origin}/api/v1/accounts/search`)
  url.searchParams.set('q', q)
  url.searchParams.set('limit', `${limit}`)
  url.searchParams.set('resolve', resolve ? 'true' : 'false')

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal
  })
  if (!response.ok) return []
  return (await response.json()) as MastodonAccount[]
}
