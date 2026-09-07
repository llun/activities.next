import type { Relationship as MastodonRelationship } from '@/lib/types/mastodon/account/relationship'
import { toIdPathSegment } from '@/lib/utils/urlToId'

import { throwApiError } from './http'

export type ReportCategory = 'spam' | 'legal' | 'violation' | 'other'

export interface CreateReportParams {
  targetActorId: string
  statusId?: string
  category?: ReportCategory
  comment?: string
}

/**
 * Reports an account (optionally tied to a status) using the
 * Mastodon-compatible reports API.
 * @see https://docs.joinmastodon.org/methods/reports/#post
 */
export const createReport = async ({
  targetActorId,
  statusId,
  category,
  comment
}: CreateReportParams): Promise<boolean> => {
  const response = await fetch('/api/v1/reports', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    // Ids in a JSON body are never re-encoded: /api/v1/reports resolves
    // `account_id`/`status_ids` through resolveActorIdParam /
    // resolveStatusIdParams, which take a publicId, a legacy colon/`apurl_`
    // id, or a raw AP URI as-is.
    body: JSON.stringify({
      account_id: targetActorId,
      ...(statusId ? { status_ids: [statusId] } : {}),
      ...(category ? { category } : {}),
      ...(comment ? { comment } : {})
    })
  })
  return response.status === 200
}

export interface FollowParams {
  targetActorId: string
}

export type FollowStatusType = 'not_following' | 'requested' | 'following'

/**
 * Gets the follow status of the current user to the target actor
 * @returns 'following' if actively following, 'requested' if follow is pending approval, 'not_following' otherwise
 * @see https://docs.joinmastodon.org/methods/accounts/#relationships
 */
export const getFollowStatus = async ({
  targetActorId
}: FollowParams): Promise<FollowStatusType> => {
  const response = await fetch(
    `/api/v1/accounts/relationships?id[]=${encodeURIComponent(targetActorId)}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    }
  )
  if (response.status !== 200) {
    return 'not_following'
  }

  const relationships = await response.json()
  if (!relationships.length) return 'not_following'

  const relationship = relationships[0]
  if (relationship.following === true) {
    return 'following'
  }
  if (relationship.requested === true) {
    return 'requested'
  }
  return 'not_following'
}

/**
 * Checks if current user is following the target actor using Mastodon-compatible API
 * @deprecated Use getFollowStatus for more detailed status including pending requests
 * @see https://docs.joinmastodon.org/methods/accounts/#relationships
 */
export const isFollowing = async ({ targetActorId }: FollowParams) => {
  const status = await getFollowStatus({ targetActorId })
  return status === 'following'
}

/**
 * Follows an account using Mastodon-compatible API
 * @see https://docs.joinmastodon.org/methods/accounts/#follow
 */
export const follow = async ({ targetActorId }: FollowParams) => {
  const encodedId = toIdPathSegment(targetActorId)
  const response = await fetch(`/api/v1/accounts/${encodedId}/follow`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  })
  if (response.status !== 200) return false
  return true
}

/**
 * Unfollows an account using Mastodon-compatible API
 * @see https://docs.joinmastodon.org/methods/accounts/#unfollow
 */
export const unfollow = async ({ targetActorId }: FollowParams) => {
  const encodedId = toIdPathSegment(targetActorId)
  const response = await fetch(`/api/v1/accounts/${encodedId}/unfollow`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  })
  if (response.status !== 200) return false
  return true
}

export interface FollowRequestParams {
  id: string
}

const respondToFollowRequest = async (
  id: string,
  action: 'authorize' | 'reject'
) => {
  const response = await fetch(
    `/api/v1/follow_requests/${encodeURIComponent(id)}/${action}`,
    {
      method: 'POST'
    }
  )
  return response.ok
}

/**
 * Accepts a pending follow request using Mastodon-compatible API
 * @see https://docs.joinmastodon.org/methods/follow_requests/#accept
 */
export const acceptFollowRequest = ({ id }: FollowRequestParams) =>
  respondToFollowRequest(id, 'authorize')

/**
 * Rejects a pending follow request using Mastodon-compatible API
 * @see https://docs.joinmastodon.org/methods/follow_requests/#reject
 */
export const rejectFollowRequest = ({ id }: FollowRequestParams) =>
  respondToFollowRequest(id, 'reject')

export interface SwitchActorParams {
  actorId: string
}

/**
 * Switches the current session to another actor owned by the account
 */
export const switchActor = async ({ actorId }: SwitchActorParams) => {
  const response = await fetch('/api/v1/actors/switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actorId })
  })
  return response.ok
}

export interface ActorDomainsResult {
  domains: string[]
  host: string
}

export interface GetActorDomainsParams {
  signal?: AbortSignal
}

/**
 * Fetches the allowed domains for actor creation
 */
export const getActorDomains = async ({
  signal
}: GetActorDomainsParams = {}): Promise<ActorDomainsResult> => {
  const response = await fetch('/api/v1/actors/domains', {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    },
    signal
  })

  if (!response.ok) {
    await throwApiError(response, 'Failed to fetch actor domains')
  }

  const data = await response.json()
  return {
    domains: Array.isArray(data?.domains) ? data.domains : [],
    host: typeof data?.host === 'string' ? data.host : ''
  }
}

export interface CreateActorParams {
  username: string
  domain?: string
}

export interface CreateActorResult {
  id: string
  username: string
  domain: string
}

/**
 * Creates a new actor for the current account
 */
export const createActor = async ({
  username,
  domain
}: CreateActorParams): Promise<CreateActorResult> => {
  const response = await fetch('/api/v1/actors', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      username,
      domain
    })
  })

  if (!response.ok) {
    await throwApiError(response, 'Failed to create actor')
  }

  return (await response.json()) as CreateActorResult
}

export interface CancelActorDeletionParams {
  actorId: string
}

export interface CancelActorDeletionResult {
  actorId: string
  status: string
}

/**
 * Cancels a scheduled actor deletion
 */
export const cancelActorDeletion = async ({
  actorId
}: CancelActorDeletionParams): Promise<CancelActorDeletionResult> => {
  const response = await fetch('/api/v1/actors/cancel-deletion', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ actorId })
  })

  if (!response.ok) {
    await throwApiError(response, 'Failed to cancel actor deletion')
  }

  return (await response.json()) as CancelActorDeletionResult
}

export interface SetDefaultActorParams {
  actorId: string
}

export interface SetDefaultActorResult {
  defaultActorId: string
  id: string
  username: string
  domain: string
}

/**
 * Sets the default actor for the current account
 */
export const setDefaultActor = async ({
  actorId
}: SetDefaultActorParams): Promise<SetDefaultActorResult> => {
  const response = await fetch('/api/v1/actors/default', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ actorId })
  })

  if (!response.ok) {
    await throwApiError(response, 'Failed to update default actor')
  }

  return (await response.json()) as SetDefaultActorResult
}

export interface DeleteActorParams {
  actorId: string
  delayDays?: number
}

export interface DeleteActorResult {
  actorId: string
  status: string
  scheduledAt: string | null
  immediate: boolean
}

/**
 * Schedules or immediately executes deletion of an actor
 */
export const deleteActor = async ({
  actorId,
  delayDays = 0
}: DeleteActorParams): Promise<DeleteActorResult> => {
  const response = await fetch('/api/v1/actors/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ actorId, delayDays })
  })

  if (!response.ok) {
    await throwApiError(response, 'Failed to delete actor')
  }

  return (await response.json()) as DeleteActorResult
}

export interface DeleteAccountMediaParams {
  mediaId: string
}

/**
 * Deletes a media item owned by the current account
 */
export const deleteAccountMedia = async ({
  mediaId
}: DeleteAccountMediaParams): Promise<boolean> => {
  const response = await fetch(
    `/api/v1/accounts/media/${encodeURIComponent(mediaId)}`,
    {
      method: 'DELETE'
    }
  )

  if (!response.ok) {
    await throwApiError(response, 'Failed to delete media')
  }

  return true
}

/**
 * Gets relationship between current user and target actor
 * @see https://docs.joinmastodon.org/methods/accounts/#relationships
 */
export const getRelationship = async ({
  targetActorId
}: FollowParams): Promise<MastodonRelationship | null> => {
  const response = await fetch(
    `/api/v1/accounts/relationships?id[]=${encodeURIComponent(targetActorId)}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    }
  )
  if (response.status !== 200) return null

  const relationships = (await response.json()) as MastodonRelationship[]
  return relationships[0] ?? null
}
