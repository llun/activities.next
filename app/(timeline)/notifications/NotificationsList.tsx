'use client'

import { Mastodon } from '@llun/activities.schema'
import { useCallback, useEffect, useRef, useState } from 'react'

import { GroupedNotification } from '@/lib/services/notifications/groupNotifications'
import { Status } from '@/lib/models/status'

import { NotificationItem } from './NotificationItem'

interface NotificationWithData extends GroupedNotification {
  account: Mastodon.Account | null
  status?: Status | null
  groupedAccounts?: (Mastodon.Account | null)[] | null
}

interface Props {
  notifications: NotificationWithData[]
  currentActorId: string
}

export const NotificationsList = ({ notifications, currentActorId }: Props) => {
  const [readNotifications, setReadNotifications] = useState<Set<string>>(
    new Set()
  )
  const readNotificationsRef = useRef<Set<string>>(new Set())
  const observerRef = useRef<IntersectionObserver | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pendingReadsRef = useRef<Set<string>>(new Set())

  const markAsRead = useCallback(async (notificationIds: string[]) => {
    if (notificationIds.length === 0) return

    try {
      await fetch('/api/v1/notifications/read', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          notification_ids: notificationIds
        })
      })
    } catch (error) {
      console.error('Failed to mark notifications as read:', error)
    }
  }, [])

  const debouncedMarkAsRead = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = setTimeout(() => {
      const idsToMark = Array.from(pendingReadsRef.current)
      if (idsToMark.length > 0) {
        markAsRead(idsToMark)
        pendingReadsRef.current.clear()
      }
    }, 1000)
  }, [markAsRead])

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const notificationId = entry.target.getAttribute(
              'data-notification-id'
            )
            if (
              notificationId &&
              !readNotificationsRef.current.has(notificationId)
            ) {
              readNotificationsRef.current.add(notificationId)
              setReadNotifications((prev) => new Set(prev).add(notificationId))
              pendingReadsRef.current.add(notificationId)
              debouncedMarkAsRead()
            }
          }
        })
      },
      { threshold: 0.5 }
    )

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [debouncedMarkAsRead])

  const observeElement = useCallback(
    (element: HTMLElement | null) => {
      if (element && observerRef.current) {
        observerRef.current.observe(element)
      }
    },
    []
  )

  return (
    <div className="space-y-4">
      {notifications.map((notification) => (
        <NotificationItem
          key={notification.id}
          notification={notification}
          currentActorId={currentActorId}
          isRead={
            notification.isRead || readNotifications.has(notification.id)
          }
          observeElement={observeElement}
        />
      ))}
    </div>
  )
}
