'use client'

import { type ComponentType, useEffect, useRef } from 'react'

import {
  type NotificationWithAccount,
  type NotificationWithStatus,
  hasStatusActor
} from '@/app/(timeline)/notifications/types'
import type { GroupedNotification } from '@/lib/services/notifications/groupNotifications'
import type { Mastodon } from '@/lib/types/activitypub'
import type { Status } from '@/lib/types/domain/status'

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
  }
  currentActorId: string
  host: string
  isRead: boolean
  observeElement: (element: HTMLElement | null) => void
}

type StatusNotificationComponent = ComponentType<{
  host: string
  notification: NotificationWithStatus
}>

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

const assertNever = (_value: never) => {}

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
      status: notification.status ?? null
    }

    const notificationWithStatus = hasStatusActor(notificationWithAccount)
      ? notificationWithAccount
      : null

    const renderStatusNotification = (
      StatusNotification: StatusNotificationComponent
    ) => {
      if (!notificationWithStatus) {
        return renderUnavailableStatusNotification(notificationWithAccount.type)
      }

      return (
        <StatusNotification host={host} notification={notificationWithStatus} />
      )
    }

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
        return renderStatusNotification(LikeNotification)
      case 'reply':
        return renderStatusNotification(ReplyNotification)
      case 'mention':
        return renderStatusNotification(MentionNotification)
      case 'reblog':
        return renderStatusNotification(ReblogNotification)
      case 'activity_import':
        return renderStatusNotification(ActivityImportNotification)
      default:
        assertNever(notificationWithAccount.type)
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
