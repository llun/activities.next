'use client'

import { FC, useEffect, useState } from 'react'

import {
  FollowStatusType,
  follow,
  getFollowStatus,
  unfollow
} from '@/lib/client'
import { Button } from '@/lib/components/ui/button'
import type { Relationship as MastodonRelationship } from '@/lib/types/mastodon/account/relationship'

export interface FollowActionProps {
  targetActorId: string
  isLoggedIn: boolean
  initialRelationship?: MastodonRelationship | null
}

const getStatusFromRelationship = (
  relationship?: MastodonRelationship | null
): FollowStatusType | undefined => {
  if (relationship === undefined) return undefined
  if (!relationship) return 'not_following'
  if (relationship.following) return 'following'
  if (relationship.requested) return 'requested'
  return 'not_following'
}

export const FollowAction: FC<FollowActionProps> = ({
  targetActorId,
  isLoggedIn,
  initialRelationship
}) => {
  const [followingStatus, setFollowingStatus] = useState<
    FollowStatusType | undefined
  >(() => getStatusFromRelationship(initialRelationship))

  useEffect(() => {
    if (initialRelationship === undefined) {
      getFollowStatus({ targetActorId }).then(setFollowingStatus)
    }
  }, [targetActorId, initialRelationship])

  const onFollow = async (targetActorId: string) => {
    const followResult = await follow({ targetActorId })
    if (!followResult) return
    // After following, check actual status from API since it might be 'requested'
    const newStatus = await getFollowStatus({ targetActorId })
    setFollowingStatus(newStatus)
  }

  const onUnfollow = async (targetActorId: string) => {
    // Unfollowing or cancelling a pending request uses the same unfollow API
    const unfollowResult = await unfollow({ targetActorId })
    if (!unfollowResult) return
    setFollowingStatus('not_following')
  }

  const onCancelRequest = onUnfollow

  if (!isLoggedIn) return null
  if (followingStatus === undefined) return null

  if (followingStatus === 'not_following') {
    return (
      <div className="flex-shrink-0">
        <Button type="button" onClick={() => onFollow(targetActorId)}>
          Follow
        </Button>
      </div>
    )
  }

  if (followingStatus === 'requested') {
    return (
      <div className="flex-shrink-0">
        <Button
          variant="outline"
          type="button"
          onClick={() => onCancelRequest(targetActorId)}
        >
          Requested
        </Button>
      </div>
    )
  }

  return (
    <div className="flex-shrink-0">
      <Button
        variant="destructive"
        type="button"
        onClick={() => onUnfollow(targetActorId)}
      >
        Unfollow
      </Button>
    </div>
  )
}
