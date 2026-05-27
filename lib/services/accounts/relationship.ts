import { Database } from '@/lib/database/types'
import { Mastodon } from '@/lib/types/activitypub'
import { Actor } from '@/lib/types/domain/actor'
import { FollowStatus } from '@/lib/types/domain/follow'
import { urlToId } from '@/lib/utils/urlToId'

interface GetRelationshipParams {
  database: Database
  currentActor: Actor
  targetActorId: string
}

export const getRelationship = async ({
  database,
  currentActor,
  targetActorId
}: GetRelationshipParams): Promise<Mastodon.Relationship> => {
  const actor = await database.getActorFromId({ id: targetActorId })

  const [isFollowing, isFollowedBy, follow, isBlocking, isBlockedBy, muteRecord] =
    await Promise.all([
      database.isCurrentActorFollowing({
        currentActorId: currentActor.id,
        followingActorId: targetActorId
      }),
      database.isCurrentActorFollowing({
        currentActorId: targetActorId,
        followingActorId: currentActor.id
      }),
      database.getAcceptedOrRequestedFollow({
        actorId: currentActor.id,
        targetActorId
      }),
      database.isBlocking({
        actorId: currentActor.id,
        targetActorId
      }),
      database.isBlocking({
        actorId: targetActorId,
        targetActorId: currentActor.id
      }),
      database.getMute({
        actorId: currentActor.id,
        targetActorId
      })
    ])

  const isRequested = Boolean(
    follow && follow.status === FollowStatus.enum.Requested
  )

  return Mastodon.Relationship.parse({
    id: urlToId(targetActorId),
    following: isFollowing,
    showing_reblogs: isFollowing,
    notifying: false,
    followed_by: isFollowedBy,
    blocking: isBlocking,
    blocked_by: isBlockedBy,
    muting: muteRecord !== null,
    muting_notifications: muteRecord?.notifications ?? false,
    requested: isRequested,
    requested_by: false,
    domain_blocking: false,
    endorsed: false,
    languages: ['en'],
    note: actor?.summary ?? ''
  })
}
