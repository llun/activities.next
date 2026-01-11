'use client'

import { Mastodon } from '@llun/activities.schema'
import { useRef, useEffect } from 'react'

import { GroupedNotification } from '@/lib/services/notifications/groupNotifications'
import { Status } from '@/lib/services/timelines/showStatus'

import { FollowNotification } from './components/FollowNotification'
import { FollowRequestNotification } from './components/FollowRequestNotification'
import { LikeNotification } from './components/LikeNotification'
import { MentionNotification } from './components/MentionNotification'
import { ReplyNotification } from './components/ReplyNotification'

interface NotificationWithData extends GroupedNotification {
  account: Mastodon.Account | null
  status?: Status | null
  groupedAccounts?: (Mastodon.Account | null)[] | null
}

interface Props {
  notification: NotificationWithData
  currentActorId: string
  isRead: boolean
  observeElement: (element: HTMLElement | null) => void
}

export const NotificationItem = ({
  notification,
  currentActorId,
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

  const renderNotification = () => {
    switch (notification.type) {
      case 'follow_request':
        return (
          <FollowRequestNotification
            notification={notification}
            currentActorId={currentActorId}
          />
        )
      case 'follow':
        return <FollowNotification notification={notification} />
      case 'like':
        return <LikeNotification notification={notification} />
      case 'reply':
        return <ReplyNotification notification={notification} />
      case 'mention':
        return <MentionNotification notification={notification} />
      default:
        return null
    }
  }

  return (
    <div
      ref={elementRef}
      data-notification-id={notification.id}
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
