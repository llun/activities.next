'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { markNotificationsRead } from '@/lib/client'
import type { GroupedNotification } from '@/lib/services/notifications/groupNotifications'
import type { Mastodon } from '@/lib/types/activitypub'
import type { Status } from '@/lib/types/domain/status'

import { NotificationItem } from './NotificationItem'

interface NotificationWithData extends GroupedNotification {
  account: Mastodon.Account | null
  status?: Status | null
}

interface Props {
  notifications: NotificationWithData[]
  host: string
  currentTime: number
}

export const NotificationsList = ({
  notifications,
  host,
  currentTime
}: Props) => {
  const router = useRouter()
  const [readNotifications, setReadNotifications] = useState<Set<string>>(
    new Set()
  )
  const readNotificationsRef = useRef<Set<string>>(new Set())
  const observerRef = useRef<IntersectionObserver | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pendingReadsRef = useRef<Set<string>>(new Set())
  const [markReadError, setMarkReadError] = useState(false)
  // Store the callback in a ref so we can update it without recreating the observer
  const callbackRef = useRef<(entries: IntersectionObserverEntry[]) => void>(
    () => {}
  )

  const markAsRead = useCallback(
    async (notificationIds: string[]) => {
      if (notificationIds.length === 0) return true

      try {
        const didMark = await markNotificationsRead({ notificationIds })
        if (!didMark) {
          setMarkReadError(true)
          return false
        }
        setMarkReadError(false)
        // Refresh the layout to update the notification badge count
        router.refresh()
        return true
      } catch {
        setMarkReadError(true)
        return false
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
        void markAsRead(idsToMark).then((didMark) => {
          if (!didMark) return
          idsToMark.forEach((id) => pendingReadsRef.current.delete(id))
        })
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
    <div className="space-y-3">
      {markReadError ? (
        <p className="text-sm text-destructive" role="alert">
          Notifications could not be marked as read.
        </p>
      ) : null}
      <div className="divide-y divide-border overflow-hidden rounded-xl border bg-card shadow-sm">
        {notifications.map((notification) => (
          <NotificationItem
            key={notification.id}
            notification={notification}
            host={host}
            isRead={
              notification.isRead || readNotifications.has(notification.id)
            }
            currentTime={currentTime}
            observeElement={observeElement}
          />
        ))}
      </div>
    </div>
  )
}
