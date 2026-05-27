import { FC } from 'react'

import { BlockAction } from '@/lib/components/block-action/block-action'
import { FollowAction } from '@/lib/components/follow-action/follow-action'
import { MuteAction } from '@/lib/components/mute-action/mute-action'
import type { Relationship as MastodonRelationship } from '@/lib/types/mastodon/account/relationship'

interface ProfileRelationshipActionsProps {
  targetActorId: string
  isLoggedIn: boolean
  relationship: MastodonRelationship | null
}

export const isBlockedRelationship = (
  relationship: MastodonRelationship | null
) => Boolean(relationship?.blocking || relationship?.blocked_by)

export const ProfileRelationshipActions: FC<
  ProfileRelationshipActionsProps
> = ({ targetActorId, isLoggedIn, relationship }) => (
  <div className="flex flex-wrap gap-2">
    {!isBlockedRelationship(relationship) ? (
      <>
        <FollowAction targetActorId={targetActorId} isLoggedIn={isLoggedIn} />
        <MuteAction
          targetActorId={targetActorId}
          isLoggedIn={isLoggedIn}
          initialRelationship={relationship}
        />
      </>
    ) : null}
    <BlockAction
      targetActorId={targetActorId}
      isLoggedIn={isLoggedIn}
      initialRelationship={relationship}
    />
  </div>
)
