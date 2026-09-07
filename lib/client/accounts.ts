import { toIdPathSegment } from '@/lib/utils/urlToId'

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
