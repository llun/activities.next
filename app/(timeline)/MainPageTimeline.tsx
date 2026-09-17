'use client'

import { RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FC, useCallback, useEffect, useRef, useState } from 'react'

import { getTimeline } from '@/lib/client'
import { AnnouncementBanner } from '@/lib/components/announcements/AnnouncementBanner'
import { LoadMoreButton } from '@/lib/components/load-more-button/load-more-button'
import { PageHeader } from '@/lib/components/page-header'
import { PostBox } from '@/lib/components/post-box/post-box'
import { MOBILE_FEED_SURFACE_CLASS } from '@/lib/components/posts/feedLayout'
import { ReplyToast } from '@/lib/components/posts/reply-toast'
import {
  reconcileStatusesMetadata,
  removeOriginalStatus,
  updateMatchingStatus
} from '@/lib/components/posts/statusArray'
import { TimelineFeed } from '@/lib/components/posts/timeline-feed'
import { getStatusReplyTargetId } from '@/lib/components/posts/timelineModel'
import { useLoadMoreOnVisible } from '@/lib/components/posts/useLoadMoreOnVisible'
import { ScrollToTopButton } from '@/lib/components/scroll-to-top-button'
import { Button } from '@/lib/components/ui/button'
import { Timeline } from '@/lib/services/timelines/types'
import { PostLineLimit } from '@/lib/types/database/rows'
import { ActorProfile } from '@/lib/types/domain/actor'
import {
  Status,
  StatusNote,
  StatusPoll,
  getOriginalStatus
} from '@/lib/types/domain/status'
import { TimelineContext } from '@/lib/types/domain/timeline'
import { StatusReaction } from '@/lib/types/mastodon/statusReaction'
import { cn } from '@/lib/utils'
import { getStatusDetailPathClient } from '@/lib/utils/getStatusDetailPathClient'

interface MainPageTimelineProps {
  host: string
  profile: ActorProfile
  currentTime: number
  isMediaUploadEnabled: boolean
  statuses: Status[]
  timelineContext?: TimelineContext
  initialNextMaxStatusId?: string | null
  postLineLimit?: PostLineLimit
  readingGroupBoosts?: boolean
}

export const MainPageTimeline: FC<MainPageTimelineProps> = ({
  host,
  profile,
  currentTime,
  isMediaUploadEnabled,
  statuses,
  timelineContext,
  initialNextMaxStatusId = null,
  postLineLimit,
  readingGroupBoosts
}) => {
  const router = useRouter()
  const [currentStatuses, setCurrentStatuses] = useState<Status[]>(statuses)
  const [currentTimelineContext, setCurrentTimelineContext] = useState<
    TimelineContext | undefined
  >(timelineContext)
  const [replyToastStatus, setReplyToastStatus] = useState<Status | null>(null)
  const [_nextMaxStatusId, setNextMaxStatusId] = useState<string | null>(
    initialNextMaxStatusId
  )
  const [hasMoreStatuses, setHasMoreStatuses] = useState<boolean>(
    statuses.length > 0 || Boolean(initialNextMaxStatusId)
  )
  const [isLoadingMoreStatuses, setLoadingMoreStatuses] =
    useState<boolean>(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [newerPostsCount, setNewerPostsCount] = useState<number>(0)
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false)

  const isLoadingRef = useRef<boolean>(false)
  const isPollingRef = useRef<boolean>(false)
  const lastFailedFetchRef = useRef<(() => Promise<void>) | null>(null)
  const lastStatusIdRef = useRef<string | null>(
    initialNextMaxStatusId ||
      (statuses.length > 0 ? statuses[statuses.length - 1].id : null)
  )
  const currentStatusesRef = useRef<Status[]>(currentStatuses)
  currentStatusesRef.current = currentStatuses

  // Gently reconcile attachment metadata if the statuses prop delivers
  // updated classifications (e.g. after navigating back from detail view,
  // revalidation, or prop update), preserving loaded pages, order, scroll,
  // user interactions, and local state.
  useEffect(() => {
    if (!statuses || statuses.length === 0) return

    setCurrentStatuses((previousStatuses) =>
      reconcileStatusesMetadata(previousStatuses, statuses)
    )
  }, [statuses])

  useEffect(() => {
    if (timelineContext) {
      setCurrentTimelineContext(timelineContext)
    }
  }, [timelineContext])

  // A new post composed in the top box, or a quote created inline from a
  // feed row, is prepended so it appears immediately.
  const onStatusCreated = (status: Status) => {
    setCurrentStatuses((previousValue) => [status, ...previousValue])
  }

  // When a reply is created inline from a feed row, update the parent status's
  // reply count and insert the reply directly next to the replied message in the feed.
  const onReplyCreated = useCallback((reply: Status) => {
    const originalReply = getOriginalStatus(reply)
    const parentId =
      ('reply' in originalReply &&
      typeof originalReply.reply === 'string' &&
      originalReply.reply.trim()
        ? originalReply.reply.trim()
        : null) || getStatusReplyTargetId(originalReply)

    if (parentId) {
      setCurrentStatuses((previousStatuses) => {
        const withUpdatedCount = updateMatchingStatus(
          previousStatuses,
          parentId,
          (target) => ({
            ...target,
            totalReplies: (target.totalReplies ?? 0) + 1,
            replies: target.replies ? [...target.replies, reply] : [reply]
          })
        )

        const parentIndex = withUpdatedCount.findIndex((s) => {
          if (s.id === parentId || s.publicId === parentId) return true
          const orig = getOriginalStatus(s)
          return (
            orig.id === parentId ||
            orig.url === parentId ||
            orig.publicId === parentId
          )
        })

        if (parentIndex !== -1) {
          if (withUpdatedCount.some((s) => s.id === reply.id)) {
            return withUpdatedCount
          }
          const next = [...withUpdatedCount]
          next.splice(parentIndex + 1, 0, reply)
          return next
        }

        if (withUpdatedCount.some((s) => s.id === reply.id)) {
          return withUpdatedCount
        }
        return [reply, ...withUpdatedCount]
      })
    } else {
      setCurrentStatuses((previousStatuses) => [reply, ...previousStatuses])
    }

    setReplyToastStatus(reply)
  }, [])

  const onPostUpdated = useCallback((status: Status) => {
    // Announce-aware (like onPostDeleted): also refreshes a boost row whose
    // original was the edited post. An edited status is always a note/poll.
    setCurrentStatuses((previousStatuses) =>
      updateMatchingStatus(
        previousStatuses,
        status.id,
        () => status as StatusNote | StatusPoll
      )
    )
  }, [])

  const onPostDeleted = useCallback((status: Status) => {
    setCurrentStatuses((previousStatuses) =>
      removeOriginalStatus(previousStatuses, status.id)
    )
  }, [])

  const onLikeChanged = useCallback(
    (status: StatusNote | StatusPoll, isLiked: boolean) => {
      setCurrentStatuses((previousStatuses) =>
        updateMatchingStatus(previousStatuses, status.id, (target) => ({
          ...target,
          isActorLiked: isLiked,
          totalLikes: isLiked
            ? target.totalLikes + 1
            : Math.max(0, target.totalLikes - 1)
        }))
      )
    },
    []
  )

  const onBookmarkChanged = useCallback(
    (status: StatusNote | StatusPoll, isBookmarked: boolean) => {
      setCurrentStatuses((previousStatuses) =>
        updateMatchingStatus(previousStatuses, status.id, (target) => ({
          ...target,
          isActorBookmarked: isBookmarked
        }))
      )
    },
    []
  )

  const onReactionsChanged = useCallback(
    (status: StatusNote | StatusPoll, reactions: StatusReaction[]) => {
      setCurrentStatuses((previousStatuses) =>
        updateMatchingStatus(previousStatuses, status.id, (target) => ({
          ...target,
          reactions
        }))
      )
    },
    []
  )

  const loadMoreStatuses = useCallback(async () => {
    const lastStatusId = lastStatusIdRef.current
    if (isLoadingRef.current || !lastStatusId) return

    isLoadingRef.current = true
    setLoadingMoreStatuses(true)
    setFetchError(null)
    try {
      const result = await getTimeline({
        timeline: Timeline.MAIN,
        maxStatusId: lastStatusId
      })
      const nextCursor = result.nextMaxStatusId ?? null
      setNextMaxStatusId(nextCursor)
      lastStatusIdRef.current = nextCursor
      setHasMoreStatuses(Boolean(result.nextMaxStatusId))

      if (result.statuses.length > 0) {
        setCurrentStatuses((prev) => {
          const existingIds = new Set(prev.map((s) => s.id))
          const newStatuses = result.statuses.filter(
            (s) => !existingIds.has(s.id)
          )
          if (newStatuses.length === 0) {
            return prev
          }
          return [...prev, ...newStatuses]
        })
      }
      if (result.context) {
        setCurrentTimelineContext((prev) => ({
          ancestorsById: {
            ...(prev?.ancestorsById ?? {}),
            ...result.context?.ancestorsById
          }
        }))
      }
      lastFailedFetchRef.current = null
    } catch (_error) {
      setFetchError('Failed to load posts')
      lastFailedFetchRef.current = loadMoreStatuses
    } finally {
      isLoadingRef.current = false
      setLoadingMoreStatuses(false)
    }
  }, [])

  const { loadMoreRef, isLoadMoreVisible } = useLoadMoreOnVisible({
    enabled: hasMoreStatuses,
    onLoadMore: loadMoreStatuses
  })

  const refreshTimeline = useCallback(async () => {
    // isLoadingRef serializes refreshes, so only one runs at a time and there
    // is no concurrent request to guard against.
    if (isLoadingRef.current) return

    isLoadingRef.current = true
    setIsRefreshing(true)
    setLoadingMoreStatuses(true)
    setFetchError(null)

    try {
      const result = await getTimeline({ timeline: Timeline.MAIN })
      setCurrentStatuses(result.statuses)
      if (result.context) {
        setCurrentTimelineContext(result.context)
      }
      setNextMaxStatusId(result.nextMaxStatusId ?? null)
      setHasMoreStatuses(
        result.statuses.length > 0 || Boolean(result.nextMaxStatusId)
      )
      lastStatusIdRef.current =
        result.nextMaxStatusId ||
        (result.statuses.length > 0
          ? result.statuses[result.statuses.length - 1].id
          : null)
      setNewerPostsCount(0)
      lastFailedFetchRef.current = null
    } catch (_error) {
      setFetchError('Failed to load posts')
      lastFailedFetchRef.current = refreshTimeline
    } finally {
      setLoadingMoreStatuses(false)
      isLoadingRef.current = false
      setIsRefreshing(false)
    }
  }, [])

  const handleRetry = useCallback(() => {
    setFetchError(null)
    if (lastFailedFetchRef.current) {
      void lastFailedFetchRef.current()
    }
  }, [])

  const handleCleanTopSnapshot = useCallback(async () => {
    setNewerPostsCount(0)
    if (
      typeof window !== 'undefined' &&
      typeof window.scrollTo === 'function'
    ) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    await refreshTimeline()
  }, [refreshTimeline])

  useEffect(() => {
    const pollNewerPosts = async () => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState !== 'visible'
      ) {
        return
      }
      if (isLoadingRef.current || isPollingRef.current) return

      const topStatus = currentStatusesRef.current[0]
      if (!topStatus) return

      isPollingRef.current = true
      try {
        const result = await getTimeline({
          timeline: Timeline.MAIN,
          minStatusId: topStatus.id,
          prevMinStatusId: topStatus.id,
          limit: 5
        })
        if (result.statuses && result.statuses.length > 0) {
          const currentIds = new Set(
            currentStatusesRef.current.map((s) => s.id)
          )
          const freshNewCount = result.statuses.filter(
            (s) => !currentIds.has(s.id)
          ).length
          if (freshNewCount > 0) {
            setNewerPostsCount(freshNewCount)
          }
        }
      } catch (_error) {
        // Foreground polling failure is silent
      } finally {
        isPollingRef.current = false
      }
    }

    const interval = setInterval(() => {
      void pollNewerPosts()
    }, 15000)

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void pollNewerPosts()
      }
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange)
    }

    return () => {
      clearInterval(interval)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
      }
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
        bottomSlot={
          newerPostsCount > 0 ? (
            <Button
              type="button"
              variant="pill"
              onClick={handleCleanTopSnapshot}
              className="pointer-events-auto shadow-xs"
            >
              {newerPostsCount} new {newerPostsCount === 1 ? 'post' : 'posts'} ↑
            </Button>
          ) : undefined
        }
      />

      <section
        className={`rounded-xl border bg-card p-4 shadow-sm max-md:-mt-6 ${MOBILE_FEED_SURFACE_CLASS}`}
      >
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

      <div
        aria-hidden="true"
        className="max-md:-mt-6 max-md:ml-[calc(50%_-_50vw)] max-md:h-px max-md:w-screen max-md:bg-border md:hidden"
      />

      <section className="max-md:-mt-6">
        {currentStatuses.length > 0 ? (
          <TimelineFeed
            host={host}
            currentTime={currentTime}
            statuses={currentStatuses}
            timelineContext={currentTimelineContext}
            currentActor={profile}
            showActions
            readingGroupBoosts={readingGroupBoosts}
            isMediaUploadEnabled={isMediaUploadEnabled}
            postLineLimit={postLineLimit}
            onStatusCreated={onStatusCreated}
            onReplyCreated={onReplyCreated}
            onPostUpdated={onPostUpdated}
            onPostDeleted={onPostDeleted}
            onLikeChanged={onLikeChanged}
            onBookmarkChanged={onBookmarkChanged}
            onReactionsChanged={onReactionsChanged}
          />
        ) : isLoadingMoreStatuses || isRefreshing ? (
          <div
            className={`rounded-xl border bg-card p-8 text-center text-muted-foreground shadow-sm ${MOBILE_FEED_SURFACE_CLASS}`}
          >
            <p className="text-sm font-medium">Loading timeline...</p>
          </div>
        ) : fetchError ? null : (
          <div
            className={`rounded-xl border bg-card p-8 text-center text-muted-foreground shadow-sm ${MOBILE_FEED_SURFACE_CLASS}`}
          >
            <h2 className="mb-2 text-xl font-semibold">
              Your timeline is empty
            </h2>
            <p>Follow some people to see their posts here.</p>
          </div>
        )}
        {hasMoreStatuses && (
          <div
            ref={loadMoreRef}
            aria-hidden="true"
            className="h-px w-full pointer-events-none"
          />
        )}
      </section>

      {fetchError && (
        <div className="p-4 text-center text-sm text-destructive" role="alert">
          <p>{fetchError}</p>
          <button
            type="button"
            onClick={handleRetry}
            className="mt-2 rounded-md border border-destructive px-3 py-1 text-xs font-semibold hover:bg-destructive/10"
          >
            Retry
          </button>
        </div>
      )}

      {hasMoreStatuses && (
        <LoadMoreButton
          presentation="overlay"
          hasItems={currentStatuses.length > 0}
          isLoading={isLoadingMoreStatuses}
          onClick={loadMoreStatuses}
        />
      )}

      {replyToastStatus ? (
        <ReplyToast
          status={replyToastStatus}
          onDismiss={() => setReplyToastStatus(null)}
          onViewReply={(statusToView) => {
            void (async () => {
              const detailPath = await getStatusDetailPathClient(statusToView)
              if (detailPath) router.push(detailPath)
            })()
          }}
        />
      ) : null}
    </div>
  )
}
