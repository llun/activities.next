'use client'

import { FC, useEffect, useState } from 'react'

import {
  FollowStatusType,
  follow,
  getFollowStatus,
  unfollow
} from '../../client'
import { Button } from '../ui/button'

export interface FollowActionProps {
  targetActorId: string
  isLoggedIn: boolean
}
export const FollowAction: FC<FollowActionProps> = ({
  targetActorId,
  isLoggedIn
}) => {
  const [followingStatus, setFollowingStatus] = useState<
    FollowStatusType | undefined
  >()
  useEffect(() => {
    getFollowStatus({ targetActorId }).then(setFollowingStatus)
  }, [targetActorId])

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
