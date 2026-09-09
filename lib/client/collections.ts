import type { CollectionEntity } from '@/lib/types/mastodon/collection'

// Collections (Mastodon 4.6 Collections API + activities.next feed extension).
// A collection is a shareable, consent-gated feed of accounts the owner
// highlights. Like list ids, collection ids are opaque UUIDs (not url/id
// encoded). Account ids are Mastodon Account ids (a publicId, or the legacy
// `urlToId` form on a pre-backfill row); the routes resolve either back to an
// actor URI, so pass them through unchanged.

export interface CollectionParams {
  title?: string
  description?: string | null
  topic?: string | null
  language?: string | null
  visibility?: CollectionEntity['visibility']
  feedEnabled?: boolean
}

export const collectionRequestBody = ({
  title,
  description,
  topic,
  language,
  visibility,
  feedEnabled
}: CollectionParams) => ({
  ...(title !== undefined ? { title } : {}),
  // description/topic/language are nullable: an explicit `null` clears them, so
  // forward `null` while still omitting an `undefined` (untouched) field.
  ...(description !== undefined ? { description } : {}),
  ...(topic !== undefined ? { topic } : {}),
  ...(language !== undefined ? { language } : {}),
  ...(visibility !== undefined ? { visibility } : {}),
  ...(feedEnabled !== undefined ? { feed_enabled: feedEnabled } : {})
})

export interface CreateCollectionParams extends CollectionParams {
  title: string
}

export const createCollection = async (
  params: CreateCollectionParams
): Promise<CollectionEntity | null> => {
  const response = await fetch('/api/v1/collections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(collectionRequestBody(params))
  })
  if (!response.ok) return null
  // Mastodon 4.6 wraps the created collection; unwrap so component callers
  // keep receiving the entity itself.
  const data = (await response.json()) as { collection: CollectionEntity }
  return data.collection
}

export interface UpdateCollectionParams extends CollectionParams {
  collectionId: string
}

export const updateCollection = async ({
  collectionId,
  ...params
}: UpdateCollectionParams): Promise<CollectionEntity | null> => {
  const response = await fetch(
    `/api/v1/collections/${encodeURIComponent(collectionId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collectionRequestBody(params))
    }
  )
  if (!response.ok) return null
  // Mastodon 4.6 wraps the updated collection; unwrap for component callers.
  const data = (await response.json()) as { collection: CollectionEntity }
  return data.collection
}

export const deleteCollection = async (
  collectionId: string
): Promise<boolean> => {
  const response = await fetch(
    `/api/v1/collections/${encodeURIComponent(collectionId)}`,
    { method: 'DELETE' }
  )
  return response.ok
}

export interface CollectionAccountsMutationParams {
  collectionId: string
  accountIds: string[]
}

export const mutateCollectionAccounts = async (
  method: 'POST' | 'DELETE',
  { collectionId, accountIds }: CollectionAccountsMutationParams
): Promise<boolean> => {
  if (accountIds.length === 0) return true
  const response = await fetch(
    `/api/v1/collections/${encodeURIComponent(collectionId)}/items`,
    {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_ids: accountIds })
    }
  )
  return response.ok
}

export const addCollectionAccounts = (
  params: CollectionAccountsMutationParams
): Promise<boolean> => mutateCollectionAccounts('POST', params)

export const removeCollectionAccounts = (
  params: CollectionAccountsMutationParams
): Promise<boolean> => mutateCollectionAccounts('DELETE', params)

export interface CollectionMembershipParams {
  collectionId: string
  // The acting member's own Mastodon Account id (a publicId, or the legacy
  // `urlToId` form on a pre-backfill row). The approve/revoke routes accept it
  // as an extension alongside the Mastodon 4.6 CollectionItem id and require it
  // to resolve to the authenticated caller.
  accountId: string
}

export const setCollectionMembership = async (
  action: 'approve' | 'revoke',
  { collectionId, accountId }: CollectionMembershipParams
): Promise<boolean> => {
  const response = await fetch(
    `/api/v1/collections/${encodeURIComponent(
      collectionId
    )}/items/${encodeURIComponent(accountId)}/${action}`,
    { method: 'POST' }
  )
  return response.ok
}

// A member opts IN to a collection's public projection (consent gate).
export const approveCollectionMembership = (
  params: CollectionMembershipParams
): Promise<boolean> => setCollectionMembership('approve', params)

// A member opts OUT of a collection's public projection.
export const revokeCollectionMembership = (
  params: CollectionMembershipParams
): Promise<boolean> => setCollectionMembership('revoke', params)
