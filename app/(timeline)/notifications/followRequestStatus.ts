import type { FollowRequestInitialStatus } from '@/app/(timeline)/notifications/types'
import { type Follow, FollowStatus } from '@/lib/types/domain/follow'

// Map the current Follow record between a requester and the viewer to the UI
// state of its follow-request notification row. A still-Requested follow is
// actionable; an Accepted one reads as already approved; everything else
// (Rejected, Undo, or no record at all) is resolved and offers no actions, so a
// handled request never shows stale Approve / Reject buttons.
export const followRequestStatusFromFollow = (
  follow: Follow | null
): FollowRequestInitialStatus => {
  if (!follow) return 'resolved'
  switch (follow.status) {
    case FollowStatus.enum.Requested:
      return 'pending'
    case FollowStatus.enum.Accepted:
      return 'accepted'
    default:
      return 'resolved'
  }
}
