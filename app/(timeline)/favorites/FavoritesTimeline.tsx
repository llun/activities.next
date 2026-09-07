'use client'

import { FC, useCallback, useRef, useState } from 'react'

import { getFavourites } from '@/lib/client'
import { PageHeader } from '@/lib/components/page-header'
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

const MAX_EMPTY_FAVOURITE_CONTINUATIONS = 5

interface FavoritesTimelineProps {
  host: string
  statuses: Status[]
  initialNextMaxFavouriteId?: string | null
  currentTime: number
  currentActor: ActorProfile
  isMediaUploadEnabled?: boolean
  postLineLimit?: PostLineLimit
}

export const FavoritesTimeline: FC<FavoritesTimelineProps> = ({
  host,
  statuses,
  initialNextMaxFavouriteId = null,
  currentTime,
  currentActor,
  isMediaUploadEnabled,
  postLineLimit
}) => {
  const [currentStatuses, setCurrentStatuses] = useState<Status[]>(statuses)
  const [hasMoreStatuses, setHasMoreStatuses] = useState<boolean>(
    Boolean(initialNextMaxFavouriteId)
  )
  const [isLoadingMoreStatuses, setLoadingMoreStatuses] =
    useState<boolean>(false)
  const isLoadingRef = useRef<boolean>(false)
  const lastFavouriteIdRef = useRef<string | null>(initialNextMaxFavouriteId)

  const onPostDeleted = useCallback((status: Status) => {
    setCurrentStatuses((previousStatuses) =>
      removeOriginalStatus(previousStatuses, status.id)
    )
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

  const onLikeChanged = useCallback(
    (status: StatusNote | StatusPoll, isLiked: boolean) => {
      if (!isLiked) {
        setCurrentStatuses((previousStatuses) =>
          removeOriginalStatus(previousStatuses, status.id)
        )
      } else {
        setCurrentStatuses((previousStatuses) =>
          updateMatchingStatus(previousStatuses, status.id, (target) => ({
            ...target,
            isActorLiked: isLiked,
            totalLikes: target.totalLikes + 1
          }))
        )
      }
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

  // Keep this page's copy in step with a reaction the viewer just added, so a
  // later edit (which replaces the status object) doesn't re-render the reaction
  // row from a stale `reactions` prop and drop the chip.
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
    let nextFavouriteId = lastFavouriteIdRef.current
    if (isLoadingRef.current || !nextFavouriteId) return

    isLoadingRef.current = true
    setLoadingMoreStatuses(true)
    try {
      let emptyContinuations = 0

      while (nextFavouriteId) {
        const result = await getFavourites({
          maxFavouriteId: nextFavouriteId
        })

        lastFavouriteIdRef.current = result.nextMaxFavouriteId

        if (result.statuses.length > 0) {
          setHasMoreStatuses(Boolean(result.nextMaxFavouriteId))
          setCurrentStatuses((previousStatuses) => [
            ...previousStatuses,
            ...result.statuses
          ])
          return
        }

        if (!result.nextMaxFavouriteId) {
          setHasMoreStatuses(false)
          return
        }

        emptyContinuations++
        if (emptyContinuations >= MAX_EMPTY_FAVOURITE_CONTINUATIONS) {
          setHasMoreStatuses(true)
          return
        }

        nextFavouriteId = result.nextMaxFavouriteId
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
      <PageHeader title="Favorites" description="Posts you have favorited" />

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
          onLikeChanged={onLikeChanged}
          onBookmarkChanged={onBookmarkChanged}
          onReactionsChanged={onReactionsChanged}
        />
      ) : (
        <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground shadow-sm">
          <h2 className="mb-2 text-xl font-semibold">No favorites yet</h2>
          <p>Posts you favorite will appear here.</p>
        </div>
      )}

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
