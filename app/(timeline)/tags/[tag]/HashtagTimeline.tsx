'use client'

import { Hash } from 'lucide-react'
import { FC, useCallback, useRef, useState } from 'react'

import { getHashtagTimeline } from '@/lib/client'
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

interface HashtagTimelineProps {
  tag: string
  host: string
  statuses: Status[]
  nextMaxStatusId?: string | null
  postCount: number
  currentTime: number
  currentActor?: ActorProfile
  isMediaUploadEnabled?: boolean
  postLineLimit?: PostLineLimit
}

export const HashtagTimeline: FC<HashtagTimelineProps> = ({
  tag,
  host,
  statuses,
  nextMaxStatusId,
  postCount,
  currentTime,
  currentActor,
  isMediaUploadEnabled,
  postLineLimit
}) => {
  const [currentStatuses, setCurrentStatuses] = useState<Status[]>(statuses)
  const [hasMoreStatuses, setHasMoreStatuses] = useState<boolean>(
    statuses.length > 0 || Boolean(nextMaxStatusId)
  )
  const [isLoadingMoreStatuses, setLoadingMoreStatuses] =
    useState<boolean>(false)
  const isLoadingRef = useRef<boolean>(false)
  const lastStatusIdRef = useRef<string | null>(
    nextMaxStatusId ||
      (statuses.length > 0 ? statuses[statuses.length - 1].id : null)
  )

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
    try {
      const result = await getHashtagTimeline({
        tag,
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
      // Error loading more - user can retry
    } finally {
      isLoadingRef.current = false
      setLoadingMoreStatuses(false)
    }
  }, [tag])

  const { loadMoreRef, isLoadMoreVisible } = useLoadMoreOnVisible({
    onLoadMore: loadMoreStatuses
  })

  return (
    <div className="space-y-6">
      <ScrollToTopButton
        isLoadMoreVisible={hasMoreStatuses && isLoadMoreVisible}
      />
      <div>
        <div className="flex items-center gap-2">
          <Hash className="size-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">{tag}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {postCount} {postCount === 1 ? 'post' : 'posts'}
        </p>
      </div>

      {currentStatuses.length > 0 ? (
        <Posts
          host={host}
          currentTime={currentTime}
          statuses={currentStatuses}
          currentActor={currentActor}
          showActions={Boolean(currentActor)}
          showReadOnlyStats={!currentActor}
          isMediaUploadEnabled={isMediaUploadEnabled}
          postLineLimit={postLineLimit}
          onPostDeleted={onPostDeleted}
          onPostUpdated={onPostUpdated}
          onLikeChanged={onLikeChanged}
          onBookmarkChanged={onBookmarkChanged}
          onReactionsChanged={onReactionsChanged}
        />
      ) : (
        <div
          className={`rounded-xl border bg-card p-8 text-center text-muted-foreground shadow-sm ${MOBILE_FEED_SURFACE_CLASS}`}
        >
          <h2 className="text-xl font-semibold mb-2">No posts with #{tag}</h2>
          <p>Be the first to post with this hashtag.</p>
        </div>
      )}

      {hasMoreStatuses && lastStatusIdRef.current && (
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
