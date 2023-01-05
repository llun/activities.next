import { FC } from 'react'

import { Button } from './Button'

export interface FollowActionProps {
  targetActorId: string
  isLoggedIn: boolean
  followingStatus?: boolean
}
export const FollowAction: FC<FollowActionProps> = ({
  targetActorId,
  isLoggedIn,
  followingStatus
}) => {
  if (!isLoggedIn) return null
  if (followingStatus === undefined) return null

  if (followingStatus === false) {
    return (
      <div className="flex-shrink-0">
        <form action="/api/v1/accounts/follow" method="post">
          <input type="hidden" name="target" value={targetActorId} />
          <Button type="submit">Follow</Button>
        </form>
      </div>
    )
  }
  return (
    <div className="flex-shrink-0">
      <form action="/api/v1/accounts/unfollow" method="post">
        <input type="hidden" name="target" value={targetActorId} />
        <Button variant="danger" type="submit">
          Unfollow
        </Button>
      </form>
    </div>
  )
}
