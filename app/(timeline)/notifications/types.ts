import type { GroupedNotification } from '@/lib/services/notifications/groupNotifications'
import type { Mastodon } from '@/lib/types/activitypub'
import type { Status } from '@/lib/types/domain/status'

// The server-resolved state of a follow request, derived from the current
// `Follow` record between the requester and the viewer. It seeds the initial
// UI of FollowRequestNotification so an already-handled request never renders
// stale Approve / Reject actions on load:
//   - 'pending'  → the follow is still Requested; show the actions.
//   - 'accepted' → the follow was already approved; show an approved label.
//   - 'resolved' → no Accepted/Requested follow exists (rejected, withdrawn,
//                  or gone); show a neutral, non-actionable label.
export type FollowRequestInitialStatus = 'pending' | 'accepted' | 'resolved'

export interface NotificationWithAccount extends GroupedNotification {
  account: Mastodon.Account
  status: Status | null
}

export type StatusWithActor = Status & {
  actor: NonNullable<Status['actor']>
}

export interface NotificationWithStatus extends NotificationWithAccount {
  status: StatusWithActor
}

export const hasStatusActor = (
  notification: NotificationWithAccount
): notification is NotificationWithStatus => Boolean(notification.status?.actor)
