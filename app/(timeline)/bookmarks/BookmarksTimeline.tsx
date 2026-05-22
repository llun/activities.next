'use client'

import { FC, useCallback, useEffect, useRef, useState } from 'react'

import { getBookmarks } from '@/lib/client'
import { PageHeader } from '@/lib/components/page-header'
import { Posts } from '@/lib/components/posts/posts'
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

const MAX_EMPTY_BOOKMARK_CONTINUATIONS = 5

interface BookmarksTimelineProps {
  host: string
  statuses: Status[]
  initialNextMaxBookmarkId?: string | null
  currentTime: number
  currentActor: ActorProfile
  postLineLimit?: PostLineLimit
}

export const BookmarksTimeline: FC<BookmarksTimelineProps> = ({
  host,
  statuses,
  initialNextMaxBookmarkId = null,
  currentTime,
  currentActor,
  postLineLimit
}) => {
  const [currentStatuses, setCurrentStatuses] = useState<Status[]>(statuses)
  const [hasMoreStatuses, setHasMoreStatuses] = useState<boolean>(
    Boolean(initialNextMaxBookmarkId)
  )
  const [isLoadingMoreStatuses, setLoadingMoreStatuses] =
    useState<boolean>(false)
  const [isLoadMoreVisible, setIsLoadMoreVisible] = useState<boolean>(false)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const isLoadingRef = useRef<boolean>(false)
  const lastBookmarkIdRef = useRef<string | null>(initialNextMaxBookmarkId)

  const removeStatus = (status: Status) => {
    setCurrentStatuses((previousStatuses) =>
      previousStatuses.filter((item) => item.id !== status.id)
    )
  }

  const onBookmarkChanged = (
    status: StatusNote | StatusPoll,
    isBookmarked: boolean
  ) => {
    if (isBookmarked) return
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

  useEffect(() => {
    if (!hasMoreStatuses) return

    const loadMoreElement = loadMoreRef.current
    if (!loadMoreElement || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        setIsLoadMoreVisible(entry.isIntersecting)

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
  }, [hasMoreStatuses, loadMoreStatuses])

  return (
    <div className="space-y-6">
      <ScrollToTopButton
        isLoadMoreVisible={hasMoreStatuses && isLoadMoreVisible}
      />
      <PageHeader
        title="Bookmarks"
        description="Saved posts from your timelines."
      />

      <section className="overflow-hidden rounded-2xl border bg-background/80 shadow-sm">
        {currentStatuses.length > 0 ? (
          <Posts
            host={host}
            className="mt-0"
            currentTime={currentTime}
            statuses={currentStatuses}
            currentActor={currentActor}
            showActions
            postLineLimit={postLineLimit}
            onPostDeleted={removeStatus}
            onBookmarkChanged={onBookmarkChanged}
          />
        ) : (
          <div className="p-8 text-center text-muted-foreground">
            <h2 className="mb-2 text-xl font-semibold">No bookmarks yet</h2>
            <p>Bookmark posts to find them here later.</p>
          </div>
        )}

        {hasMoreStatuses && lastBookmarkIdRef.current && (
          <div ref={loadMoreRef} className="border-t p-4 text-center">
            <Button
              variant="outline"
              disabled={isLoadingMoreStatuses}
              onClick={loadMoreStatuses}
            >
              {isLoadingMoreStatuses ? 'Loading...' : 'Load more'}
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}
