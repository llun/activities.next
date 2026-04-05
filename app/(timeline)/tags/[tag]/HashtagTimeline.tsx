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
  postCount: number
  currentActor?: ActorProfile
  postLineLimit?: PostLineLimit
}

export const HashtagTimeline: FC<HashtagTimelineProps> = ({
  tag,
  host,
  statuses,
  postCount,
  currentActor,
  postLineLimit
}) => {
  const [currentStatuses, setCurrentStatuses] = useState<Status[]>(statuses)
  const [hasMoreStatuses, setHasMoreStatuses] = useState<boolean>(
    statuses.length > 0
  )
  const [isLoadingMoreStatuses, setLoadingMoreStatuses] =
    useState<boolean>(false)
  const [isLoadMoreVisible, setIsLoadMoreVisible] = useState<boolean>(false)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const isLoadingRef = useRef<boolean>(false)
  const lastStatusIdRef = useRef<string | null>(
    statuses.length > 0 ? statuses[statuses.length - 1].id : null
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
      const statuses = await getHashtagTimeline({
        tag,
        maxStatusId: lastStatusId
      })
      if (statuses.length === 0) {
        setHasMoreStatuses(false)
        return
      }
      lastStatusIdRef.current = statuses[statuses.length - 1].id
      setCurrentStatuses((prev) => [...prev, ...statuses])
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

      <section className="overflow-hidden rounded-2xl border bg-background/80 shadow-sm">
        {currentStatuses.length > 0 ? (
          <Posts
            host={host}
            className="mt-0"
            currentTime={new Date()}
            statuses={currentStatuses}
            currentActor={currentActor}
            showActions={Boolean(currentActor)}
            postLineLimit={postLineLimit}
            onPostDeleted={onPostDeleted}
          />
        ) : (
          <div className="p-8 text-center text-muted-foreground">
            <h2 className="text-xl font-semibold mb-2">No posts with #{tag}</h2>
            <p>Be the first to post with this hashtag.</p>
          </div>
        )}

        {hasMoreStatuses && currentStatuses.length > 0 && (
          <div ref={loadMoreRef} className="p-4 text-center border-t">
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
