import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'
import { Follow, FollowStatus } from '@/lib/types/domain/follow'
import { Status, StatusType } from '@/lib/types/domain/status'
import { getVisibility } from '@/lib/utils/getVisibility'

import { getViewerFollow } from './getViewerFollow'

const isPublicOrUnlisted = (status: Status): boolean => {
  const visibility = getVisibility(status.to, status.cc)
  return visibility === 'public' || visibility === 'unlisted'
}

const hasFollowersAudience = (status: Status): boolean => {
  const followersUrl = status.actor?.followersUrl
  const fallbackFollowersUrl = `${status.actorId}/followers`
  const isFollowersAudience = (recipient: string) =>
    recipient === followersUrl || recipient === fallbackFollowersUrl

  return (
    status.to.some(isFollowersAudience) || status.cc.some(isFollowersAudience)
  )
}

const isDirectRecipient = (status: Status, actor: Actor): boolean =>
  status.to.includes(actor.id) || status.cc.includes(actor.id)

export const isStatusPubliclyReadable = (status: Status): boolean => {
  if (!isPublicOrUnlisted(status)) return false

  if (status.type === StatusType.enum.Announce) {
    return isStatusPubliclyReadable(status.originalStatus)
  }

  return true
}

// "Does this follow row make the viewer a follower?" — the one rule both halves
// of this module need, and which each had its own copy of. A Requested follow is
// not a follower: it is the pending state, and treating it as one would hand a
// stranger the followers-only audience by asking.
//
// The rule is shared; the lookup that feeds it is not.
// `resolveActorStatusesAudience` asks about the profile's own actor, which
// `getRelationship` asks about again on the same render, so it reads through the
// request-memoized `getViewerFollow`.
//
// `canActorReadSingleStatus` still queries the database directly, and that is a
// scope boundary rather than a claim that it never repeats — it does. It asks
// about whoever wrote a boosted ORIGINAL, once per status inside
// `getProfileData`'s own per-status pass, with no `followerStateByActorId`
// prefetch on that path: a profile carrying two boosts of the same
// followers-only author issues the identical query twice. Routing this call
// through `getViewerFollow` too would collapse that as well, and is safe —
// nothing writes this direction while serving a boosted status — but it reaches
// a dozen further call sites (inbox handling, status create/edit, search, polls),
// most on paths with no request scope to memoize into, so it is deliberately
// left for its own change.
const isAcceptedFollow = (follow: Follow | null): boolean =>
  follow?.status === FollowStatus.enum.Accepted

const canActorReadSingleStatus = async ({
  database,
  status,
  currentActor,
  isFollower,
  followerStateByActorId
}: {
  database: Database
  status: Status
  currentActor: Actor
  isFollower?: boolean
  followerStateByActorId?: ReadonlyMap<string, boolean>
}): Promise<boolean> => {
  if (isPublicOrUnlisted(status)) return true
  if (currentActor.id === status.actorId) return true
  if (isDirectRecipient(status, currentActor)) return true

  if (hasFollowersAudience(status)) {
    const prefetchedIsFollower =
      isFollower ?? followerStateByActorId?.get(status.actorId)
    if (prefetchedIsFollower !== undefined) return prefetchedIsFollower

    return isAcceptedFollow(
      await database.getAcceptedOrRequestedFollow({
        actorId: currentActor.id,
        targetActorId: status.actorId
      })
    )
  }

  return false
}

// The query-scoping half of this module. `canActorReadStatus` above decides one
// already-loaded status; this decides which of an actor's statuses a viewer is
// allowed to be shown in the first place, as the argument set
// `getActorStatuses`/`getAttachmentsForActor` take.
//
// It exists because those arguments are individually optional and default to
// "no filter" — omitting all of them is a real mode (the owner's own timeline,
// and the full-history export in `scripts/backup/actorArchive.ts`), so a caller
// that simply forgets them gets that mode silently rather than an error. The
// profile page did exactly that and served followers-only posts and direct
// messages to logged-out visitors. Resolve the audience here rather than
// spelling the four arguments out at each call site, so "who may see this
// actor's statuses" has one answer.
export type ActorStatusesAudience = {
  isOwner: boolean
  isFollower: boolean
  publicOnly: boolean
  visibleToActorId: string | null
  includeFollowersOnly: boolean
  followersAudience: string | null
}

export const resolveActorStatusesAudience = async ({
  database,
  targetActor,
  currentActor
}: {
  database: Database
  // Structural rather than `Pick<Actor, …>` so a remote profile can pass the
  // ActivityPub person's `followers`, which is optional there. A missing
  // followers URL only costs the `${id}/followers` fallback the SQL layer adds.
  targetActor: { id: string; followersUrl?: string | null }
  // Accepts `undefined` as well as `null` so an absent viewer cannot be read as
  // a present one: `currentActor === null` is false for `undefined`, which is
  // the shape that turns this into "no filter".
  currentActor?: Actor | null
}): Promise<ActorStatusesAudience> => {
  const viewer = currentActor ?? null
  const isOwner = Boolean(viewer && viewer.id === targetActor.id)

  const isFollower =
    viewer && !isOwner
      ? isAcceptedFollow(
          await getViewerFollow(database, viewer.id, targetActor.id)
        )
      : false

  return {
    isOwner,
    isFollower,
    publicOnly: !viewer,
    // The owner is deliberately left unfiltered: all three arguments falsy is
    // what lets them see their own private posts.
    visibleToActorId: viewer && !isOwner ? viewer.id : null,
    includeFollowersOnly: isFollower,
    followersAudience: targetActor.followersUrl ?? null
  }
}

export const canActorReadStatus = async ({
  database,
  status,
  currentActor,
  isFollower,
  followerStateByActorId
}: {
  database: Database
  status: Status
  currentActor: Actor | null
  isFollower?: boolean
  followerStateByActorId?: ReadonlyMap<string, boolean>
}): Promise<boolean> => {
  if (isStatusPubliclyReadable(status)) return true
  if (!currentActor) return false

  if (status.type === StatusType.enum.Announce) {
    const canReadAnnounce = await canActorReadSingleStatus({
      database,
      status,
      currentActor,
      isFollower,
      followerStateByActorId
    })

    if (!canReadAnnounce) return false

    return canActorReadStatus({
      database,
      status: status.originalStatus,
      currentActor,
      followerStateByActorId
    })
  }

  return canActorReadSingleStatus({
    database,
    status,
    currentActor,
    isFollower,
    followerStateByActorId
  })
}
