'use client'

import { useEffect, useRef } from 'react'

import { GroupedNotification } from '@/lib/services/notifications/groupNotifications'
import { Mastodon } from '@/lib/types/activitypub'
import { Status } from '@/lib/types/domain/status'

import { FollowNotification } from './components/FollowNotification'
import { FollowRequestNotification } from './components/FollowRequestNotification'
import { LikeNotification } from './components/LikeNotification'
import { MentionNotification } from './components/MentionNotification'
import { ReplyNotification } from './components/ReplyNotification'

interface NotificationWithData extends GroupedNotification {
  account: Mastodon.Account
  status?: Status
  groupedAccounts?: (Mastodon.Account | null)[] | null
}

interface Props {
  notification: GroupedNotification & {
    account: Mastodon.Account | null
    status?: Status | null
    groupedAccounts?: (Mastodon.Account | null)[] | null
  }
  currentActorId: string
  host: string
  isRead: boolean
  observeElement: (element: HTMLElement | null) => void
}

export const NotificationItem = ({
  notification,
  currentActorId,
  host,
  isRead,
  observeElement
}: Props) => {
  const elementRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (elementRef.current && !isRead) {
      observeElement(elementRef.current)
    }
  }, [observeElement, isRead])

  if (!notification.account) {
    return null
  }

  // After null check, we know account is non-null
  const notificationWithAccount: NotificationWithData = {
    ...notification,
    account: notification.account,
    status: notification.status ?? undefined
  }

  const renderNotification = () => {
    switch (notificationWithAccount.type) {
      case 'follow_request':
        return (
          <FollowRequestNotification
            notification={notificationWithAccount}
            currentActorId={currentActorId}
          />
        )
      case 'follow':
        return <FollowNotification notification={notificationWithAccount} />
      case 'like':
        // Status-requiring notifications - type assertion for compatibility
        return (
          <LikeNotification
            host={host}
            notification={
              notificationWithAccount as NotificationWithData & {
                status: Status
              }
            }
          />
        )
      case 'reply':
        return (
          <ReplyNotification
            host={host}
            notification={
              notificationWithAccount as NotificationWithData & {
                status: Status
              }
            }
          />
        )
      case 'mention':
        return (
          <MentionNotification
            host={host}
            notification={
              notificationWithAccount as NotificationWithData & {
                status: Status
              }
            }
          />
        )
      default:
        return null
    }
  }

  return (
    <div
      ref={elementRef}
      data-notification-id={notification.id}
      data-grouped-ids={notification.groupedIds?.join(',') || notification.id}
      className="relative rounded-xl border bg-background/80 p-4"
    >
      {!isRead && (
        <div
          className="absolute left-2 top-2 h-2 w-2 rounded-full bg-red-500"
          aria-label="Unread"
        />
      )}
      {renderNotification()}
    </div>
  )
}
