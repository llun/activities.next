'use client'

import { FC, useEffect, useState } from 'react'

import { follow, isFollowing, unfollow } from '../../client'
import { Button } from '../ui/button'

export interface FollowActionProps {
  targetActorId: string
  isLoggedIn: boolean
}
export const FollowAction: FC<FollowActionProps> = ({
  targetActorId,
  isLoggedIn
}) => {
  const [followingStatus, setFollowingStatus] = useState<boolean | undefined>()
  useEffect(() => {
    isFollowing({ targetActorId }).then(setFollowingStatus)
  }, [targetActorId])

  const onFollow = async (targetActorId: string) => {
    const followResult = await follow({ targetActorId })
    if (!followResult) return
    setFollowingStatus(true)
  }

  const onUnfollow = async (targetActorId: string) => {
    const unfollowResult = await unfollow({ targetActorId })
    if (!unfollowResult) return
    setFollowingStatus(false)
  }

  if (!isLoggedIn) return null
  if (followingStatus === undefined) return null

  if (!followingStatus) {
    return (
      <div className="flex-shrink-0">
        <Button type="button" onClick={() => onFollow(targetActorId)}>
          Follow
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
