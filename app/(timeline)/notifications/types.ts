import type { GroupedNotification } from '@/lib/services/notifications/groupNotifications'
import type { Mastodon } from '@/lib/types/activitypub'
import type { Status } from '@/lib/types/domain/status'

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
