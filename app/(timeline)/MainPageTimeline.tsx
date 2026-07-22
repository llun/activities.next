'use client'

import { RefreshCw } from 'lucide-react'
import { FC, useCallback, useEffect, useRef, useState } from 'react'

import { getTimeline } from '@/lib/client'
import { AnnouncementBanner } from '@/lib/components/announcements/AnnouncementBanner'
import { PageHeader } from '@/lib/components/page-header'
import { PostBox } from '@/lib/components/post-box/post-box'
import { Posts } from '@/lib/components/posts/posts'
import { ScrollToTopButton } from '@/lib/components/scroll-to-top-button'
import { Button } from '@/lib/components/ui/button'
import { Timeline } from '@/lib/services/timelines/types'
import { PostLineLimit } from '@/lib/types/database/rows'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'

interface MainPageTimelineProps {
  host: string
  profile: ActorProfile
  currentTime: number
  isMediaUploadEnabled: boolean
  statuses: Status[]
  initialNextMaxStatusId?: string | null
  postLineLimit?: PostLineLimit
}

export const MainPageTimeline: FC<MainPageTimelineProps> = ({
  host,
  profile,
  currentTime,
  isMediaUploadEnabled,
  statuses,
  initialNextMaxStatusId = null,
  postLineLimit
}) => {
  const [currentStatuses, setCurrentStatuses] = useState<Status[]>(statuses)
  const [hasMoreStatuses, setHasMoreStatuses] = useState<boolean>(
    statuses.length > 0 || Boolean(initialNextMaxStatusId)
  )
  const [isLoadingMoreStatuses, setLoadingMoreStatuses] =
    useState<boolean>(false)
  const [isLoadMoreVisible, setIsLoadMoreVisible] = useState<boolean>(false)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const isLoadingRef = useRef<boolean>(false)
  const lastStatusIdRef = useRef<string | null>(
    initialNextMaxStatusId ||
      (statuses.length > 0 ? statuses[statuses.length - 1].id : null)
  )

  // A new post composed in the top box, or a reply/quote created inline from a
  // feed row, is prepended so it appears immediately.
  const onStatusCreated = (status: Status) => {
    setCurrentStatuses((previousValue) => [status, ...previousValue])
  }

  const onPostUpdated = (updatedStatus: Status) => {
    setCurrentStatuses((previousStatuses) =>
      previousStatuses.map((status) =>
        status.id === updatedStatus.id ? updatedStatus : status
      )
    )
  }

  const onPostDeleted = (status: Status) => {
    const statusIndex = currentStatuses.indexOf(status)
    const newStatuses = [
      ...currentStatuses.slice(0, statusIndex),
      ...currentStatuses.slice(statusIndex + 1)
    ]
    setCurrentStatuses(newStatuses)
    lastStatusIdRef.current =
      newStatuses.length > 0 ? newStatuses[newStatuses.length - 1].id : null
  }

  const loadMoreStatuses = useCallback(async () => {
    const lastStatusId = lastStatusIdRef.current
    if (isLoadingRef.current || !lastStatusId) return

    isLoadingRef.current = true
    setLoadingMoreStatuses(true)
    try {
      const result = await getTimeline({
        timeline: Timeline.MAIN,
        maxStatusId: lastStatusId
      })
      if (result.statuses.length === 0) {
        if (result.nextMaxStatusId) {
          lastStatusIdRef.current = result.nextMaxStatusId
          return
        }
        setHasMoreStatuses(false)
        return
      }
      lastStatusIdRef.current =
        result.nextMaxStatusId || result.statuses[result.statuses.length - 1].id
      setCurrentStatuses((prev) => [...prev, ...result.statuses])
    } catch (_error) {
      // Error loading more - user can retry by clicking the button
    } finally {
      isLoadingRef.current = false
      setLoadingMoreStatuses(false)
    }
  }, [])

  // Set up IntersectionObserver for automatic loading
  useEffect(() => {
    const loadMoreElement = loadMoreRef.current
    if (!loadMoreElement) return

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        setIsLoadMoreVisible(entry.isIntersecting)

        // Automatically load more when the button comes into view
        // The loadMoreStatuses callback has its own guard against duplicate loads
        if (entry.isIntersecting) {
          loadMoreStatuses()
        }
      },
      {
        root: null,
        rootMargin: '0px',
        threshold: 0.1
      }
    )

    observer.observe(loadMoreElement)

    return () => {
      observer.disconnect()
    }
  }, [loadMoreStatuses])

  const [isRefreshing, setIsRefreshing] = useState<boolean>(false)

  const refreshTimeline = useCallback(async () => {
    // isLoadingRef serializes refreshes, so only one runs at a time and there
    // is no concurrent request to guard against.
    if (isLoadingRef.current) return

    isLoadingRef.current = true
    setIsRefreshing(true)
    setLoadingMoreStatuses(true)

    try {
      const result = await getTimeline({ timeline: Timeline.MAIN })
      setCurrentStatuses(result.statuses)
      setHasMoreStatuses(
        result.statuses.length > 0 || Boolean(result.nextMaxStatusId)
      )
      lastStatusIdRef.current =
        result.nextMaxStatusId ||
        (result.statuses.length > 0
          ? result.statuses[result.statuses.length - 1].id
          : null)
    } catch (_error) {
      // Error refreshing - existing posts remain visible, user can retry
    } finally {
      setLoadingMoreStatuses(false)
      isLoadingRef.current = false
      setIsRefreshing(false)
    }
  }, [])

  return (
    <div className="space-y-6">
      <ScrollToTopButton
        isLoadMoreVisible={hasMoreStatuses && isLoadMoreVisible}
      />
      <AnnouncementBanner currentTime={currentTime} />
      <PageHeader
        title="Timeline"
        description="Latest posts from your network."
        actions={
          <Button
            variant="outline"
            size="icon"
            onClick={refreshTimeline}
            disabled={isRefreshing}
            aria-label="Refresh timeline"
          >
            <RefreshCw
              className={cn('size-4', isRefreshing && 'animate-spin')}
            />
          </Button>
        }
      />

      <section className="rounded-xl border bg-card p-4 shadow-sm">
        {/* The home timeline keeps a top composer for brand-new posts. Reply,
            quote, and edit happen inline in the feed via the shared composer,
            like every other surface. */}
        <PostBox
          host={host}
          profile={profile}
          isMediaUploadEnabled={isMediaUploadEnabled}
          onDiscardReply={() => {}}
          onDiscardQuote={() => {}}
          onDiscardEdit={() => {}}
          onPostCreated={onStatusCreated}
          onPostUpdated={onPostUpdated}
        />
      </section>

      <section>
        {currentStatuses.length > 0 ? (
          <Posts
            host={host}
            currentTime={currentTime}
            statuses={currentStatuses}
            currentActor={profile}
            showActions
            isMediaUploadEnabled={isMediaUploadEnabled}
            postLineLimit={postLineLimit}
            onStatusCreated={onStatusCreated}
            onPostUpdated={onPostUpdated}
            onPostDeleted={onPostDeleted}
          />
        ) : isLoadingMoreStatuses || isRefreshing ? (
          <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground shadow-sm">
            <p className="text-sm font-medium">Loading timeline...</p>
          </div>
        ) : (
          <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground shadow-sm">
            <h2 className="mb-2 text-xl font-semibold">
              Your timeline is empty
            </h2>
            <p>Follow some people to see their posts here.</p>
          </div>
        )}
      </section>

      {hasMoreStatuses && (
        <div ref={loadMoreRef} className="text-center">
          <Button
            variant="outline"
            disabled={isLoadingMoreStatuses}
            onClick={loadMoreStatuses}
          >
            {isLoadingMoreStatuses ? 'Loading...' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  )
}
