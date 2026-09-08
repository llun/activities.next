import type { FilterAction, FilterContext } from '@/lib/types/domain/filter'
import type { Filter as MastodonFilter } from '@/lib/types/mastodon/filter'

// Filters (https://docs.joinmastodon.org/methods/filters/).
// Keyword filters for the account scope (/api/v2/filters) and the instance
// scope (/api/v2/admin/filters). Server filters are returned merged into the
// account list flagged read-only via the non-standard `server` field. Filter
// ids are opaque UUIDs (not ActivityPub URLs), so unlike status/account ids
// they never go through toIdPathSegment — they are still escaped with
// encodeURIComponent when placed in a request path.

export interface ClientFilter extends MastodonFilter {
  // Present and true only on instance-wide server filters merged into the
  // account list — these are read-only for regular accounts.
  server?: boolean
}

export interface FilterKeywordInput {
  // Set when editing an existing keyword; omit to create a new one.
  id?: string
  keyword: string
  wholeWord: boolean
  // Set on an existing keyword to remove it during an update.
  _destroy?: boolean
}

export interface FilterInput {
  title: string
  context: FilterContext[]
  filterAction: FilterAction
  // Seconds until the filter expires, or null for "never".
  expiresIn: number | null
  keywords: FilterKeywordInput[]
}

export const filterRequestBody = ({
  title,
  context,
  filterAction,
  expiresIn,
  keywords
}: FilterInput) => ({
  title,
  context,
  filter_action: filterAction,
  expires_in: expiresIn,
  keywords_attributes: keywords.map((keyword) => ({
    ...(keyword.id ? { id: keyword.id } : {}),
    keyword: keyword.keyword,
    whole_word: keyword.wholeWord,
    ...(keyword._destroy ? { _destroy: true } : {})
  }))
})

export const requestFilters = async (path: string): Promise<ClientFilter[]> => {
  const response = await fetch(path, {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  // Throw (rather than returning []) so an HTTP error is surfaced by the
  // caller's error handling instead of being indistinguishable from an
  // empty list. Mirrors the throwing pattern used by createNote().
  if (!response.ok) {
    throw new Error(`Failed to load filters (${response.status})`)
  }
  return (await response.json()) as ClientFilter[]
}

export const createFilterRequest = async (
  path: string,
  input: FilterInput
): Promise<ClientFilter | null> => {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(filterRequestBody(input))
  })
  if (!response.ok) return null
  return (await response.json()) as ClientFilter
}

export const updateFilterRequest = async (
  path: string,
  input: FilterInput
): Promise<ClientFilter | null> => {
  const response = await fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(filterRequestBody(input))
  })
  if (!response.ok) return null
  return (await response.json()) as ClientFilter
}

export const deleteFilterRequest = async (path: string): Promise<boolean> => {
  const response = await fetch(path, { method: 'DELETE' })
  return response.ok
}

export const getFilters = (): Promise<ClientFilter[]> =>
  requestFilters('/api/v2/filters')

export const createFilter = (
  input: FilterInput
): Promise<ClientFilter | null> => createFilterRequest('/api/v2/filters', input)

export const updateFilter = (
  id: string,
  input: FilterInput
): Promise<ClientFilter | null> =>
  updateFilterRequest(`/api/v2/filters/${encodeURIComponent(id)}`, input)

export const deleteFilter = (id: string): Promise<boolean> =>
  deleteFilterRequest(`/api/v2/filters/${encodeURIComponent(id)}`)

export const getServerFilters = (): Promise<ClientFilter[]> =>
  requestFilters('/api/v2/admin/filters')

export const createServerFilter = (
  input: FilterInput
): Promise<ClientFilter | null> =>
  createFilterRequest('/api/v2/admin/filters', input)

export const updateServerFilter = (
  id: string,
  input: FilterInput
): Promise<ClientFilter | null> =>
  updateFilterRequest(`/api/v2/admin/filters/${encodeURIComponent(id)}`, input)

export const deleteServerFilter = (id: string): Promise<boolean> =>
  deleteFilterRequest(`/api/v2/admin/filters/${encodeURIComponent(id)}`)
