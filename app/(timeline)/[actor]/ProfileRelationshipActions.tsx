import { FC } from 'react'

import { BlockAction } from '@/lib/components/block-action/block-action'
import { FollowAction } from '@/lib/components/follow-action/follow-action'
import { MuteAction } from '@/lib/components/mute-action/mute-action'
import { RemoteFollowDialog } from '@/lib/components/remote-follow/remote-follow-dialog'
import type { Relationship as MastodonRelationship } from '@/lib/types/mastodon/account/relationship'

interface ProfileRelationshipActionsProps {
  targetActorId: string
  targetHandle: string
  isLoggedIn: boolean
  relationship: MastodonRelationship | null
}

export const isBlockedRelationship = (
  relationship: MastodonRelationship | null
) => Boolean(relationship?.blocking || relationship?.blocked_by)

export const ProfileRelationshipActions: FC<
  ProfileRelationshipActionsProps
> = ({ targetActorId, targetHandle, isLoggedIn, relationship }) => {
  // Every action below renders nothing without a session. A logged-out visitor
  // gets the remote-follow dialog instead, so they can follow from their own
  // server the way Mastodon offers.
  if (!isLoggedIn) {
    return (
      <div className="flex flex-wrap gap-2">
        <RemoteFollowDialog targetHandle={targetHandle} />
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
      {!isBlockedRelationship(relationship) ? (
        <>
          <FollowAction
            key={`follow-${targetActorId}`}
            targetActorId={targetActorId}
            isLoggedIn={isLoggedIn}
          />
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
