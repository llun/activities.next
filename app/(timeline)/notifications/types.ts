import type { GroupedNotification } from '@/lib/services/notifications/groupNotifications'
import type { Mastodon } from '@/lib/types/activitypub'
import type { Status } from '@/lib/types/domain/status'

// The server-resolved state of a follow request, derived from the `Follow`
// record the notification references. It seeds the initial UI of
// FollowRequestNotification so an already-handled request never renders stale
// Approve / Reject actions on load:
//   - 'pending'  → the follow is still Requested; show the actions.
//   - 'accepted' → the follow was already approved; show an approved label.
//   - 'rejected' → the follow was rejected; show a rejected label.
//   - 'resolved' → the follow was withdrawn or is gone; show a neutral label.
// The component also reuses these states for its own optimistic Approve/Reject.
export type FollowRequestInitialStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'resolved'

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
