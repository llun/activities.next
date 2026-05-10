'use client'

import { useEffect, useRef } from 'react'

import {
  type NotificationWithAccount,
  hasStatusActor
} from '@/app/(timeline)/notifications/types'
import { GroupedNotification } from '@/lib/services/notifications/groupNotifications'
import { Mastodon } from '@/lib/types/activitypub'
import { Status } from '@/lib/types/domain/status'

import { ActivityImportNotification } from './components/ActivityImportNotification'
import { FollowNotification } from './components/FollowNotification'
import { FollowRequestNotification } from './components/FollowRequestNotification'
import { LikeNotification } from './components/LikeNotification'
import { MentionNotification } from './components/MentionNotification'
import { ReblogNotification } from './components/ReblogNotification'
import { ReplyNotification } from './components/ReplyNotification'

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

const renderUnavailableNotification = (message: string) => (
  <div className="text-sm text-muted-foreground">{message}</div>
)

const renderUnavailableStatusNotification = (notificationType: string) => {
  if (notificationType === 'activity_import') {
    return renderUnavailableNotification(
      'This imported activity is no longer available.'
    )
  }

  return renderUnavailableNotification('This post is no longer available.')
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

  const renderNotification = () => {
    if (!notification.account) {
      return renderUnavailableNotification(
        'This notification is no longer available.'
      )
    }

    const notificationWithAccount: NotificationWithAccount = {
      ...notification,
      account: notification.account,
      status: notification.status ?? undefined
    }

    const notificationWithStatus = hasStatusActor(notificationWithAccount)
      ? notificationWithAccount
      : null

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
        if (!notificationWithStatus)
          return renderUnavailableStatusNotification(notification.type)

        return (
          <LikeNotification host={host} notification={notificationWithStatus} />
        )
      case 'reply':
        if (!notificationWithStatus)
          return renderUnavailableStatusNotification(notification.type)

        return (
          <ReplyNotification
            host={host}
            notification={notificationWithStatus}
          />
        )
      case 'mention':
        if (!notificationWithStatus)
          return renderUnavailableStatusNotification(notification.type)

        return (
          <MentionNotification
            host={host}
            notification={notificationWithStatus}
          />
        )
      case 'reblog':
        if (!notificationWithStatus)
          return renderUnavailableStatusNotification(notification.type)

        return (
          <ReblogNotification
            host={host}
            notification={notificationWithStatus}
          />
        )
      case 'activity_import':
        if (!notificationWithStatus)
          return renderUnavailableStatusNotification(notification.type)

        return (
          <ActivityImportNotification
            host={host}
            notification={notificationWithStatus}
          />
        )
      default:
        return renderUnavailableNotification(
          'This notification is no longer available.'
        )
    }
  }

  const content = renderNotification()

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
      {content}
    </div>
  )
}
