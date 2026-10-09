'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { FollowRequestInitialStatus } from '@/app/(timeline)/notifications/types'
import { markNotificationsRead } from '@/lib/client'
import { Alert } from '@/lib/components/surface/Alert'
import { Frame } from '@/lib/components/surface/Frame'
import type { GroupedNotification } from '@/lib/services/notifications/groupNotifications'
import type { Mastodon } from '@/lib/types/activitypub'
import type { Status } from '@/lib/types/domain/status'

import { NotificationItem } from './NotificationItem'

interface NotificationWithData extends GroupedNotification {
  account: Mastodon.Account | null
  status?: Status | null
  collection?: { id: string; title: string } | null
  followRequestStatus?: FollowRequestInitialStatus
}

interface Props {
  notifications: NotificationWithData[]
  host: string
  currentTime: number
  // The viewer's own Mastodon Account id, forwarded to collection-consent rows.
  currentAccountId?: string
}

export const NotificationsList = ({
  notifications,
  host,
  currentTime,
  currentAccountId
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

  // Ids with a request in flight. A flush or Retry sends only what is pending
  // and not already on its way, so no id is ever sent twice at once and a late
  // failure can only be about ids that really are still unmarked.
  const inFlightRef = useRef<Set<string>>(new Set())

  const sendPending = useCallback(async () => {
    const ids = Array.from(pendingReadsRef.current).filter(
      (id) => !inFlightRef.current.has(id)
    )
    if (ids.length === 0) return
    ids.forEach((id) => inFlightRef.current.add(id))

    const didMark = await markNotificationsRead({ notificationIds: ids }).catch(
      () => false
    )
    ids.forEach((id) => inFlightRef.current.delete(id))

    if (!didMark) {
      if (ids.some((id) => pendingReadsRef.current.has(id))) {
        setMarkReadError(true)
      }
      return
    }
    ids.forEach((id) => pendingReadsRef.current.delete(id))
    if (pendingReadsRef.current.size === 0) setMarkReadError(false)
    // Refresh the layout to update the notification badge count
    router.refresh()
  }, [router])

  const debouncedMarkAsRead = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = setTimeout(() => {
      void sendPending()
    }, 1000)
  }, [sendPending])

  // The failed ids stay pending until a request succeeds, so Retry needs no
  // state of its own. The alert goes away on press and comes back only if this
  // attempt fails.
  const retryMarkAsRead = useCallback(() => {
    setMarkReadError(false)
    void sendPending()
  }, [sendPending])

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
        <Alert
          title="Notifications could not be marked as read."
          onRetry={retryMarkAsRead}
        />
      ) : null}
      <Frame divided className="overflow-hidden">
        {notifications.map((notification) => (
          <NotificationItem
            key={notification.id}
            notification={notification}
            host={host}
            isRead={
              notification.isRead || readNotifications.has(notification.id)
            }
            currentTime={currentTime}
            currentAccountId={currentAccountId}
            observeElement={observeElement}
          />
        ))}
      </Frame>
    </div>
  )
}
