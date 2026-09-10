'use client'

import { FC, useCallback, useRef, useState } from 'react'

import { getBookmarks } from '@/lib/client'
import { PageHeader } from '@/lib/components/page-header'
import { MOBILE_FEED_SURFACE_CLASS } from '@/lib/components/posts/feedLayout'
import { Posts } from '@/lib/components/posts/posts'
import {
  removeOriginalStatus,
  updateMatchingStatus
} from '@/lib/components/posts/statusArray'
import { useLoadMoreOnVisible } from '@/lib/components/posts/useLoadMoreOnVisible'
import { ScrollToTopButton } from '@/lib/components/scroll-to-top-button'
import { Button } from '@/lib/components/ui/button'
import { PostLineLimit } from '@/lib/types/database/rows'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Status, StatusNote, StatusPoll } from '@/lib/types/domain/status'
import { StatusReaction } from '@/lib/types/mastodon/statusReaction'

const MAX_EMPTY_BOOKMARK_CONTINUATIONS = 5

interface BookmarksTimelineProps {
  host: string
  statuses: Status[]
  initialNextMaxBookmarkId?: string | null
  currentTime: number
  currentActor: ActorProfile
  isMediaUploadEnabled?: boolean
  postLineLimit?: PostLineLimit
}

export const BookmarksTimeline: FC<BookmarksTimelineProps> = ({
  host,
  statuses,
  initialNextMaxBookmarkId = null,
  currentTime,
  currentActor,
  isMediaUploadEnabled,
  postLineLimit
}) => {
  const [currentStatuses, setCurrentStatuses] = useState<Status[]>(statuses)
  const [hasMoreStatuses, setHasMoreStatuses] = useState<boolean>(
    Boolean(initialNextMaxBookmarkId)
  )
  const [isLoadingMoreStatuses, setLoadingMoreStatuses] =
    useState<boolean>(false)
  const isLoadingRef = useRef<boolean>(false)
  const lastBookmarkIdRef = useRef<string | null>(initialNextMaxBookmarkId)

  const onPostDeleted = useCallback((status: Status) => {
    setCurrentStatuses((previousStatuses) =>
      removeOriginalStatus(previousStatuses, status.id)
    )
  }, [])

  const onPostUpdated = useCallback((status: Status) => {
    setCurrentStatuses((previousStatuses) =>
      updateMatchingStatus(
        previousStatuses,
        status.id,
        () => status as StatusNote | StatusPoll
      )
    )
  }, [])

  const onBookmarkChanged = useCallback(
    (status: StatusNote | StatusPoll, isBookmarked: boolean) => {
      if (!isBookmarked) {
        setCurrentStatuses((previousStatuses) =>
          removeOriginalStatus(previousStatuses, status.id)
        )
      } else {
        setCurrentStatuses((previousStatuses) =>
          updateMatchingStatus(previousStatuses, status.id, (target) => ({
            ...target,
            isActorBookmarked: isBookmarked
          }))
        )
      }
    },
    []
  )

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
    let nextBookmarkId = lastBookmarkIdRef.current
    if (isLoadingRef.current || !nextBookmarkId) return

    isLoadingRef.current = true
    setLoadingMoreStatuses(true)
    try {
      let emptyContinuations = 0

      while (nextBookmarkId) {
        const result = await getBookmarks({
          maxBookmarkId: nextBookmarkId
        })

        lastBookmarkIdRef.current = result.nextMaxBookmarkId

        if (result.statuses.length > 0) {
          setHasMoreStatuses(Boolean(result.nextMaxBookmarkId))
          setCurrentStatuses((previousStatuses) => [
            ...previousStatuses,
            ...result.statuses
          ])
          return
        }

        if (!result.nextMaxBookmarkId) {
          setHasMoreStatuses(false)
          return
        }

        emptyContinuations++
        if (emptyContinuations >= MAX_EMPTY_BOOKMARK_CONTINUATIONS) {
          setHasMoreStatuses(true)
          return
        }

        nextBookmarkId = result.nextMaxBookmarkId
      }
    } catch (_error) {
      // Error loading more - user can retry by clicking the button
    } finally {
      isLoadingRef.current = false
      setLoadingMoreStatuses(false)
    }
  }, [])

  const { loadMoreRef, isLoadMoreVisible } = useLoadMoreOnVisible({
    enabled: hasMoreStatuses,
    onLoadMore: loadMoreStatuses
  })

  return (
    <div className="space-y-6">
      <ScrollToTopButton
        isLoadMoreVisible={hasMoreStatuses && isLoadMoreVisible}
      />
      <PageHeader
        title="Bookmarks"
        description="Saved posts from your timelines."
      />

      {currentStatuses.length > 0 ? (
        <Posts
          host={host}
          currentTime={currentTime}
          statuses={currentStatuses}
          currentActor={currentActor}
          showActions
          isMediaUploadEnabled={isMediaUploadEnabled}
          postLineLimit={postLineLimit}
          onPostDeleted={onPostDeleted}
          onPostUpdated={onPostUpdated}
          onBookmarkChanged={onBookmarkChanged}
          onLikeChanged={onLikeChanged}
          onReactionsChanged={onReactionsChanged}
        />
      ) : (
        <div
          className={`rounded-xl border bg-card p-8 text-center text-muted-foreground shadow-sm ${MOBILE_FEED_SURFACE_CLASS}`}
        >
          <h2 className="mb-2 text-xl font-semibold">No bookmarks yet</h2>
          <p>Bookmark posts to find them here later.</p>
        </div>
      )}

      {hasMoreStatuses && lastBookmarkIdRef.current && (
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
