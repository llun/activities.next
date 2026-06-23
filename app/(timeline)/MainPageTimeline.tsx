'use client'

import { RefreshCw } from 'lucide-react'
import { FC, useCallback, useEffect, useReducer, useRef, useState } from 'react'

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
import { EditableStatus, Status } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'

import { clearAction, editAction, statusActionReducer } from './reducer'

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
  const [statusActionState, dispatchStatusAction] = useReducer(
    statusActionReducer,
    {}
  )
  const [currentStatuses, setCurrentStatuses] = useState<Status[]>(statuses)
  const [hasMoreStatuses, setHasMoreStatuses] = useState<boolean>(
    statuses.length > 0 || Boolean(initialNextMaxStatusId)
  )
  const [isLoadingMoreStatuses, setLoadingMoreStatuses] =
    useState<boolean>(false)
  const [isLoadMoreVisible, setIsLoadMoreVisible] = useState<boolean>(false)
  const refreshRequestId = useRef(0)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const isLoadingRef = useRef<boolean>(false)
  const lastStatusIdRef = useRef<string | null>(
    initialNextMaxStatusId ||
      (statuses.length > 0 ? statuses[statuses.length - 1].id : null)
  )

  const onEdit = (status: EditableStatus) => {
    dispatchStatusAction(editAction(status))
    window.scrollTo({ top: 0 })
  }

  const onReplyCreated = (status: Status) => {
    setCurrentStatuses((previousValue) => [status, ...previousValue])
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
    if (isLoadingRef.current) return

    isLoadingRef.current = true
    const requestId = ++refreshRequestId.current
    setIsRefreshing(true)
    setLoadingMoreStatuses(true)

    try {
      const result = await getTimeline({ timeline: Timeline.MAIN })
      if (requestId !== refreshRequestId.current) return
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
      if (requestId === refreshRequestId.current) {
        setLoadingMoreStatuses(false)
      }
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
        <PostBox
          host={host}
          profile={profile}
          replyStatus={statusActionState.replyStatus}
          editStatus={statusActionState.editStatus}
          isMediaUploadEnabled={isMediaUploadEnabled}
          onDiscardReply={() => dispatchStatusAction(clearAction())}
          onDiscardEdit={() => dispatchStatusAction(clearAction())}
          onPostCreated={(status: Status) => {
            setCurrentStatuses((previousValue) => [status, ...previousValue])
            dispatchStatusAction(clearAction())
          }}
          onPostUpdated={(updatedStatus: Status) => {
            setCurrentStatuses((previousStatuses) =>
              previousStatuses.map((status) =>
                status.id === updatedStatus.id ? updatedStatus : status
              )
            )
            dispatchStatusAction(clearAction())
          }}
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
            onReplyCreated={onReplyCreated}
            onEdit={onEdit}
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
