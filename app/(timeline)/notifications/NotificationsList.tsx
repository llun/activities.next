'use client'

import { Mastodon } from '@llun/activities.schema'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Status } from '@/lib/models/status'
import { GroupedNotification } from '@/lib/services/notifications/groupNotifications'

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
  const router = useRouter()
  const [readNotifications, setReadNotifications] = useState<Set<string>>(
    new Set()
  )
  const readNotificationsRef = useRef<Set<string>>(new Set())
  const observerRef = useRef<IntersectionObserver | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pendingReadsRef = useRef<Set<string>>(new Set())
  // Store the callback in a ref so we can update it without recreating the observer
  const callbackRef = useRef<(entries: IntersectionObserverEntry[]) => void>(
    () => {}
  )

  const markAsRead = useCallback(
    async (notificationIds: string[]) => {
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
        // Refresh the layout to update the notification badge count
        router.refresh()
      } catch (error) {
        console.error('Failed to mark notifications as read:', error)
      }
    },
    [router]
  )

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

  // Update the callback ref whenever dependencies change
  useEffect(() => {
    callbackRef.current = (entries: IntersectionObserverEntry[]) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const notificationId = entry.target.getAttribute(
            'data-notification-id'
          )
          const groupedIdsAttr = entry.target.getAttribute('data-grouped-ids')
          if (
            notificationId &&
            !readNotificationsRef.current.has(notificationId)
          ) {
            readNotificationsRef.current.add(notificationId)
            setReadNotifications((prev) => new Set(prev).add(notificationId))

            // Add all grouped IDs to pending reads
            if (groupedIdsAttr) {
              const groupedIds = groupedIdsAttr.split(',')
              groupedIds.forEach((id) => pendingReadsRef.current.add(id))
            } else {
              pendingReadsRef.current.add(notificationId)
            }
            debouncedMarkAsRead()
          }
        }
      })
    }
  }, [debouncedMarkAsRead])

  // Create observer once and keep it stable
  const getOrCreateObserver = useCallback(() => {
    if (!observerRef.current) {
      observerRef.current = new IntersectionObserver(
        (entries) => callbackRef.current(entries),
        { threshold: 0.5 }
      )
    }
    return observerRef.current
  }, [])

  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
        observerRef.current = null
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const observeElement = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return
      const observer = getOrCreateObserver()
      observer.observe(element)
    },
    [getOrCreateObserver]
  )

  return (
    <div className="space-y-4">
      {notifications.map((notification) => (
        <NotificationItem
          key={notification.id}
          notification={notification}
          currentActorId={currentActorId}
          isRead={notification.isRead || readNotifications.has(notification.id)}
          observeElement={observeElement}
        />
      ))}
    </div>
  )
}
