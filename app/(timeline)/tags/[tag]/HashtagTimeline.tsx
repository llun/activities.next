'use client'

import { Hash } from 'lucide-react'
import { FC, useCallback, useEffect, useRef, useState } from 'react'

import { getHashtagTimeline } from '@/lib/client'
import { Posts } from '@/lib/components/posts/posts'
import { ScrollToTopButton } from '@/lib/components/scroll-to-top-button'
import { Button } from '@/lib/components/ui/button'
import { PostLineLimit } from '@/lib/types/database/rows'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'

interface HashtagTimelineProps {
  tag: string
  host: string
  statuses: Status[]
  nextMaxStatusId?: string | null
  postCount: number
  currentTime: number
  currentActor?: ActorProfile
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
  postLineLimit
}) => {
  const [currentStatuses, setCurrentStatuses] = useState<Status[]>(statuses)
  const [hasMoreStatuses, setHasMoreStatuses] = useState<boolean>(
    statuses.length > 0 || Boolean(nextMaxStatusId)
  )
  const [isLoadingMoreStatuses, setLoadingMoreStatuses] =
    useState<boolean>(false)
  const [isLoadMoreVisible, setIsLoadMoreVisible] = useState<boolean>(false)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const isLoadingRef = useRef<boolean>(false)
  const lastStatusIdRef = useRef<string | null>(
    nextMaxStatusId ||
      (statuses.length > 0 ? statuses[statuses.length - 1].id : null)
  )

  const onPostDeleted = (status: Status) => {
    const statusIndex = currentStatuses.findIndex(
      (item) => item.id === status.id
    )
    if (statusIndex === -1) return
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

  useEffect(() => {
    const loadMoreElement = loadMoreRef.current
    if (!loadMoreElement) return

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
  }, [loadMoreStatuses])

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
          postLineLimit={postLineLimit}
          onPostDeleted={onPostDeleted}
        />
      ) : (
        <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground shadow-sm">
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
