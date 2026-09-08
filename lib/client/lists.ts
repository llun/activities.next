import type { ListEntity } from '@/lib/types/mastodon/list'

// Lists (https://docs.joinmastodon.org/methods/lists/).
// The user's curated timelines and their members. Every list call goes through
// here so components never call fetch() directly. List ids are opaque strings
// (UUIDs), so unlike status/account ids they are not url/id encoded.

export interface ListParams {
  title: string
  repliesPolicy?: ListEntity['replies_policy']
  exclusive?: boolean
}

export const listRequestBody = ({
  title,
  repliesPolicy,
  exclusive
}: ListParams) => ({
  title,
  ...(repliesPolicy !== undefined ? { replies_policy: repliesPolicy } : {}),
  ...(exclusive !== undefined ? { exclusive } : {})
})

export const createList = async (
  params: ListParams
): Promise<ListEntity | null> => {
  const response = await fetch('/api/v1/lists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(listRequestBody(params))
  })
  if (!response.ok) return null
  return (await response.json()) as ListEntity
}

export interface UpdateListParams extends ListParams {
  listId: string
}

export const updateList = async ({
  listId,
  ...params
}: UpdateListParams): Promise<ListEntity | null> => {
  const response = await fetch(`/api/v1/lists/${encodeURIComponent(listId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(listRequestBody(params))
  })
  if (!response.ok) return null
  return (await response.json()) as ListEntity
}

export const deleteList = async (listId: string): Promise<boolean> => {
  const response = await fetch(`/api/v1/lists/${encodeURIComponent(listId)}`, {
    method: 'DELETE'
  })
  return response.ok
}

export interface ListAccountsMutationParams {
  listId: string
  accountIds: string[]
}

export const mutateListAccounts = async (
  method: 'POST' | 'DELETE',
  { listId, accountIds }: ListAccountsMutationParams
): Promise<boolean> => {
  if (accountIds.length === 0) return true
  const response = await fetch(
    `/api/v1/lists/${encodeURIComponent(listId)}/accounts`,
    {
      method,
      headers: { 'Content-Type': 'application/json' },
      // accountIds are already Mastodon Account ids (a publicId, or the legacy
      // `urlToId` form on a pre-backfill row); the route resolves either back
      // to an actor URI, so pass them through unchanged.
      body: JSON.stringify({ account_ids: accountIds })
    }
  )
  return response.ok
}

export const addListAccounts = (
  params: ListAccountsMutationParams
): Promise<boolean> => mutateListAccounts('POST', params)

export const removeListAccounts = (
  params: ListAccountsMutationParams
): Promise<boolean> => mutateListAccounts('DELETE', params)
