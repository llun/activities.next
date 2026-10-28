import { Lock } from 'lucide-react'
import { FC } from 'react'

import { BlockAction } from '@/lib/components/block-action/block-action'
import { FollowAction } from '@/lib/components/follow-action/follow-action'
import { MuteAction } from '@/lib/components/mute-action/mute-action'
import { RemoteFollowDialog } from '@/lib/components/remote-follow/remote-follow-dialog'
import { Button } from '@/lib/components/ui/button'
import type { Relationship as MastodonRelationship } from '@/lib/types/mastodon/account/relationship'
import { cn } from '@/lib/utils'

interface ProfileRelationshipActionsProps {
  className?: string
  targetActorId: string
  targetHandle: string
  isLoggedIn: boolean
  relationship: MastodonRelationship | null
  /** The profile has moved: it no longer takes new followers. */
  targetMoved?: boolean
}

export const isBlockedRelationship = (
  relationship: MastodonRelationship | null
) => Boolean(relationship?.blocking || relationship?.blocked_by)

// A moved profile no longer accepts followers: anyone not already following
// gets a disabled explanation in place of every way to follow.
const FollowTurnedOff: FC = () => (
  <Button type="button" variant="outline" disabled className="flex-shrink-0">
    <Lock aria-hidden="true" />
    Follow turned off
  </Button>
)

export const ProfileRelationshipActions: FC<
  ProfileRelationshipActionsProps
> = ({
  className,
  targetActorId,
  targetHandle,
  isLoggedIn,
  relationship,
  targetMoved
}) => {
  // Every action below renders nothing without a session. A logged-out visitor
  // gets the remote-follow dialog instead, so they can follow from their own
  // server the way Mastodon offers — unless the profile moved.
  if (!isLoggedIn) {
    return (
      <div
        className={cn(
          'flex shrink-0 flex-wrap gap-2 sm:flex-nowrap',
          className
        )}
      >
        {targetMoved ? (
          <FollowTurnedOff />
        ) : (
          <RemoteFollowDialog targetHandle={targetHandle} />
        )}
      </div>
    )
  }

  // Someone already following (or with a pending request) keeps their
  // Unfollow; only the ways IN are turned off.
  const followTurnedOff =
    Boolean(targetMoved) &&
    !(relationship?.following || relationship?.requested)

  return (
    <div
      className={cn('flex shrink-0 flex-wrap gap-2 sm:flex-nowrap', className)}
    >
      {!isBlockedRelationship(relationship) ? (
        <>
          {followTurnedOff ? (
            <FollowTurnedOff />
          ) : (
            <FollowAction
              key={`follow-${targetActorId}`}
              targetActorId={targetActorId}
              isLoggedIn={isLoggedIn}
              initialRelationship={relationship}
            />
          )}
          <MuteAction
            key={`mute-${targetActorId}`}
            targetActorId={targetActorId}
            isLoggedIn={isLoggedIn}
            initialRelationship={relationship}
          />
        </>
      ) : null}
      <BlockAction
        key={`block-${targetActorId}`}
        targetActorId={targetActorId}
        isLoggedIn={isLoggedIn}
        initialRelationship={relationship}
      />
    </div>
  )
}
