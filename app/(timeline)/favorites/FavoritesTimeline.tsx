'use client'

import { FC, useCallback, useRef, useState } from 'react'

import { getFavourites } from '@/lib/client'
import { PageHeader } from '@/lib/components/page-header'
import { Posts } from '@/lib/components/posts/posts'
import { useLoadMoreOnVisible } from '@/lib/components/posts/useLoadMoreOnVisible'
import { ScrollToTopButton } from '@/lib/components/scroll-to-top-button'
import { Button } from '@/lib/components/ui/button'
import { PostLineLimit } from '@/lib/types/database/rows'
import { ActorProfile } from '@/lib/types/domain/actor'
import {
  Status,
  StatusNote,
  StatusPoll,
  StatusType,
  getOriginalStatus
} from '@/lib/types/domain/status'

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

  const removeStatus = (status: Status) => {
    setCurrentStatuses((previousStatuses) =>
      previousStatuses.filter((item) => {
        const actualStatus =
          item.type === StatusType.enum.Announce
            ? getOriginalStatus(item)
            : item
        return actualStatus.id !== status.id
      })
    )
  }

  const updateStatus = (status: Status) => {
    setCurrentStatuses((previousStatuses) =>
      previousStatuses.map((item) => (item.id === status.id ? status : item))
    )
  }

  const onLikeChanged = (status: StatusNote | StatusPoll, isLiked: boolean) => {
    if (!isLiked) removeStatus(status)
  }

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
          onPostDeleted={removeStatus}
          onPostUpdated={updateStatus}
          onLikeChanged={onLikeChanged}
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
