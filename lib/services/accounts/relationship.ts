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
  const [
    isFollowing,
    isFollowedBy,
    follow,
    isBlocking,
    isBlockedBy,
    muteRecord,
    note,
    endorsement
  ] = await Promise.all([
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
    }),
    database.getAccountNote({
      actorId: currentActor.id,
      targetActorId
    }),
    database.getEndorsement({
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
    // Fall back to the follow column defaults (reblogs=true, notify=false) when
    // a follow exists but predates these preferences.
    showing_reblogs: follow ? (follow.reblogs ?? true) : false,
    notifying: follow ? (follow.notify ?? false) : false,
    followed_by: isFollowedBy,
    blocking: isBlocking,
    blocked_by: isBlockedBy,
    muting: muteRecord !== null,
    muting_notifications: muteRecord?.notifications ?? false,
    // Mutes are permanent here; no expiry is tracked.
    muting_expires_at: null,
    requested: isRequested,
    requested_by: false,
    domain_blocking: false,
    endorsed: endorsement !== null,
    // Report the stored language filter honestly: the saved list when set,
    // or null (no filter) when absent/cleared — never a misleading default.
    languages:
      follow?.languages && follow.languages.length > 0
        ? follow.languages
        : null,
    // The relationship note is the viewer's private comment about the target
    // (Mastodon's account note), not the target's public bio/summary.
    note
  })
}
