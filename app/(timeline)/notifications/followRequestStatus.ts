import type { FollowRequestInitialStatus } from '@/app/(timeline)/notifications/types'
import type { Notification } from '@/lib/types/database/operations'
import { type Follow, FollowStatus } from '@/lib/types/domain/follow'
import { logger } from '@/lib/utils/logger'

// Map a Follow record to the UI state of its follow-request notification row. A
// still-Requested follow is actionable; an Accepted one reads as approved; a
// Rejected one as rejected; everything else (Undo, or no record at all) is
// resolved and offers no actions, so a handled request never shows stale
// Approve / Reject buttons.
export const followRequestStatusFromFollow = (
  follow: Follow | null
): FollowRequestInitialStatus => {
  if (!follow) return 'resolved'
  switch (follow.status) {
    case FollowStatus.enum.Requested:
      return 'pending'
    case FollowStatus.enum.Accepted:
      return 'accepted'
    case FollowStatus.enum.Rejected:
      return 'rejected'
    default:
      return 'resolved'
  }
}

// The narrow database surface needed to resolve a follow-request row's state.
interface FollowLookupDatabase {
  getFollowFromId(params: { followId: string }): Promise<Follow | null>
  getAcceptedOrRequestedFollow(params: {
    actorId: string
    targetActorId: string
  }): Promise<Follow | null>
}

// Resolve the live state of a follow-request notification. Prefer the exact
// follow recorded on the notification (`followId`) so a re-request after a
// rejection resolves independently of the older, rejected row for the same
// pair. Fall back to the active follow between the requester (source actor) and
// the viewer (target) only when no `followId` was recorded.
export const resolveFollowRequestStatus = async (
  database: FollowLookupDatabase,
  notification: Pick<Notification, 'followId' | 'sourceActorId'>,
  viewerActorId: string
): Promise<FollowRequestInitialStatus> => {
  try {
    const follow = notification.followId
      ? await database.getFollowFromId({ followId: notification.followId })
      : await database.getAcceptedOrRequestedFollow({
          actorId: notification.sourceActorId,
          targetActorId: viewerActorId
        })
    return followRequestStatusFromFollow(follow)
  } catch (error) {
    // A transient lookup failure must not crash the whole notifications page.
    // Degrade to 'resolved' (hide the actions) rather than 'pending', so a
    // failed lookup never re-shows Approve / Reject for an already-handled
    // request — the row self-heals on the next load.
    logger.warn(
      { err: error, followId: notification.followId },
      'Failed to resolve follow request status; defaulting to resolved'
    )
    return 'resolved'
  }
}
