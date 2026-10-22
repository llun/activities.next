'use client'

import { FC, useEffect, useState } from 'react'

import {
  FollowStatusType,
  follow,
  getFollowStatus,
  unfollow
} from '@/lib/client'
import {
  OFFLINE_MESSAGE,
  OfflineTooltip,
  useIsOffline
} from '@/lib/components/posts/actions/actionButtonShared'
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

  const offline = useIsOffline()
  const [offlineError, setOfflineError] = useState(false)

  // Back online: drop the message so it can't reappear on the next outage.
  useEffect(() => {
    if (!offline) setOfflineError(false)
  }, [offline])

  useEffect(() => {
    if (initialRelationship === undefined) {
      getFollowStatus({ targetActorId }).then(setFollowingStatus)
    }
  }, [targetActorId, initialRelationship])

  // Offline: no request, just say why.
  const guard = (run: () => void) => () => {
    if (offline) return setOfflineError(true)
    setOfflineError(false)
    run()
  }

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

  const [label, variant, run] =
    followingStatus === 'not_following'
      ? (['Follow', 'default', () => onFollow(targetActorId)] as const)
      : followingStatus === 'requested'
        ? ([
            'Requested',
            'outline',
            () => onCancelRequest(targetActorId)
          ] as const)
        : ([
            'Unfollow',
            'destructive',
            () => onUnfollow(targetActorId)
          ] as const)

  return (
    <div className="flex-shrink-0">
      <OfflineTooltip offline={offline}>
        <Button
          variant={variant}
          type="button"
          aria-disabled={offline || undefined}
          className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          onClick={guard(run)}
        >
          {label}
        </Button>
      </OfflineTooltip>
      {offline && offlineError && (
        <p className="mt-1 text-xs text-destructive-text" role="status">
          {OFFLINE_MESSAGE}
        </p>
      )}
    </div>
  )
}
