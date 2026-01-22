'use client'

import { Mastodon } from '@llun/activities.schema'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'
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
  currentPage: number
  itemsPerPage: number
  totalCount: number
}

export const NotificationsList = ({
  notifications,
  currentActorId,
  currentPage,
  itemsPerPage,
  totalCount
}: Props) => {
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

  const handleItemsPerPageChange = (value: number) => {
    router.push(`/notifications?limit=${value}&page=1`)
  }

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
      <div className="flex items-center justify-between rounded-xl border bg-background/80 p-4">
        <div className="text-sm text-muted-foreground">
          {totalCount === 0 ? (
            'No notifications'
          ) : (
            <>
              Showing{' '}
              {Math.min(totalCount, (currentPage - 1) * itemsPerPage + 1)}-
              {Math.min(currentPage * itemsPerPage, totalCount)} of {totalCount}{' '}
              notifications
            </>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              {itemsPerPage} per page
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleItemsPerPageChange(25)}>
              25 per page
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleItemsPerPageChange(50)}>
              50 per page
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleItemsPerPageChange(100)}>
              100 per page
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
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
