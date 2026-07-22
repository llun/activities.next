'use client'

import { Activity } from 'lucide-react'
import Link from 'next/link'
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { getActorStatuses } from '@/lib/client'
import { Posts } from '@/lib/components/posts/posts'
import { Button } from '@/lib/components/ui/button'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '@/lib/components/ui/tabs'
import { PostLineLimit } from '@/lib/types/database/rows'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import {
  Status,
  StatusNote,
  StatusPoll,
  StatusType
} from '@/lib/types/domain/status'

import { ActorMediaGallery } from './ActorMediaGallery'

interface Props {
  host: string
  actorId: string
  currentTime: number
  statuses: Status[]
  attachments: Attachment[]
  statusPagination?: {
    nextPageUrl: string | null
    prevPageUrl: string | null
  }
  postLineLimit?: PostLineLimit
  /**
   * The signed-in viewer's profile. When present the feed renders interactive
   * post actions (reply/boost/like/bookmark); when absent (logged-out) it
   * falls back to read-only engagement counts.
   */
  currentActor?: ActorProfile
  /** True when the signed-in viewer is looking at their own profile. */
  isCurrentUser?: boolean
  /**
   * Whether this actor has any fitness activities. Drives whether the Fitness
   * tab is offered at all (it lists the actor's public fitness posts).
   */
  hasFitnessData?: boolean
  isMediaUploadEnabled?: boolean
}

const LOAD_MORE_PAGE_LIMIT = 5
const LOAD_MORE_ERROR_MESSAGE = 'Failed to load more posts. Please try again.'

type ProfileTab = 'posts' | 'replies' | 'media' | 'fitness'

const isReply = (status: Status) => {
  switch (status.type) {
    case StatusType.enum.Note:
    case StatusType.enum.Poll:
      return !!status.reply
    case StatusType.enum.Announce:
      return false
    default:
      return false
  }
}

const hasFitnessFile = (status: Status) =>
  status.type === StatusType.enum.Note && Boolean(status.fitness)

// Apply an interactive-state patch (like/bookmark toggle) to the status with
// the given id, reaching inside a boost to patch its original status too, so
// every rendered copy (Posts/Replies/Fitness tabs share `currentStatuses`)
// stays consistent across tab switches and remounts.
const updateMatchingStatus = (
  statuses: Status[],
  targetId: string,
  patch: (target: StatusNote | StatusPoll) => StatusNote | StatusPoll
): Status[] =>
  statuses.map((item) => {
    if (item.type === StatusType.enum.Announce) {
      const original = item.originalStatus
      // Boosts wrap a Note/Poll; nested boosts aren't an interactive target.
      if (
        original.type !== StatusType.enum.Announce &&
        original.id === targetId
      ) {
        return { ...item, originalStatus: patch(original) }
      }
      return item
    }
    return item.id === targetId ? patch(item) : item
  })

const appendUniqueStatuses = (
  previousStatuses: Status[],
  nextStatuses: Status[]
) => {
  const statusIds = new Set(previousStatuses.map((status) => status.id))
  return [
    ...previousStatuses,
    ...nextStatuses.filter((status) => {
      if (statusIds.has(status.id)) return false
      statusIds.add(status.id)
      return true
    })
  ]
}

const EmptyState: FC<{ children: string }> = ({ children }) => (
  <p className="py-10 text-center text-sm text-muted-foreground">{children}</p>
)

export const ActorTimelines: FC<Props> = ({
  host,
  actorId,
  currentTime,
  statuses,
  attachments,
  statusPagination,
  postLineLimit,
  currentActor,
  isCurrentUser = false,
  hasFitnessData = false,
  isMediaUploadEnabled
}) => {
  const [activeTab, setActiveTab] = useState<ProfileTab>('posts')
  const [currentStatuses, setCurrentStatuses] = useState<Status[]>(statuses)
  const [currentStatusPagination, setCurrentStatusPagination] = useState({
    nextPageUrl: statusPagination?.nextPageUrl ?? null,
    prevPageUrl: statusPagination?.prevPageUrl ?? null
  })
  const [isLoadingMoreStatuses, setLoadingMoreStatuses] =
    useState<boolean>(false)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const isLoadingRef = useRef<boolean>(false)

  const showActions = Boolean(currentActor)
  const showFitnessTab = Boolean(hasFitnessData)

  const postStatuses = useMemo(
    () => currentStatuses.filter((status) => !isReply(status)),
    [currentStatuses]
  )
  const replyStatuses = useMemo(
    () => currentStatuses.filter((status) => isReply(status)),
    [currentStatuses]
  )
  const fitnessStatuses = useMemo(
    () => currentStatuses.filter((status) => hasFitnessFile(status)),
    [currentStatuses]
  )

  // The outbox cursor feeds the post/reply/fitness feeds (all derived from the
  // loaded status list), so the standalone load more control is offered on
  // those tabs. The media tab paginates separately via its own gallery loader.
  const canLoadMore =
    Boolean(currentStatusPagination.nextPageUrl) &&
    (activeTab === 'posts' ||
      activeTab === 'replies' ||
      activeTab === 'fitness')

  const handleStatusCreated = useCallback(
    (status: Status) => {
      // A reply or quote of another actor's post is the viewer's own status and
      // does not belong in that actor's feed. On the viewer's own profile,
      // though, the new status is theirs — surface it right away instead of
      // waiting for a reload.
      if (isCurrentUser) {
        setCurrentStatuses((previousStatuses) => [status, ...previousStatuses])
      }
    },
    [isCurrentUser]
  )

  const handlePostUpdated = useCallback((updatedStatus: Status) => {
    setCurrentStatuses((previousStatuses) =>
      previousStatuses.map((status) =>
        status.id === updatedStatus.id ? updatedStatus : status
      )
    )
  }, [])

  const handlePostDeleted = useCallback((status: Status) => {
    setCurrentStatuses((previousStatuses) =>
      previousStatuses.filter(
        (item) =>
          item.id !== status.id &&
          !(
            item.type === StatusType.enum.Announce &&
            item.originalStatus.id === status.id
          )
      )
    )
  }, [])

  const handleLikeChanged = useCallback(
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

  const handleBookmarkChanged = useCallback(
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

  const loadMoreStatuses = useCallback(async () => {
    const nextPageUrl = currentStatusPagination.nextPageUrl
    if (isLoadingRef.current || !nextPageUrl) return

    isLoadingRef.current = true
    setLoadingMoreStatuses(true)
    setLoadMoreError(null)
    try {
      let pageUrl: string | null = nextPageUrl
      let prevPageUrl: string | null = currentStatusPagination.prevPageUrl
      let nextStatuses: Status[] = []
      const visitedPageUrls = new Set<string>()

      for (
        let loadedPages = 0;
        pageUrl && loadedPages < LOAD_MORE_PAGE_LIMIT;
        loadedPages += 1
      ) {
        if (visitedPageUrls.has(pageUrl)) {
          pageUrl = null
          break
        }
        visitedPageUrls.add(pageUrl)
        const result = await getActorStatuses({
          actorId,
          pageUrl
        })

        pageUrl =
          result.nextPageUrl && !visitedPageUrls.has(result.nextPageUrl)
            ? result.nextPageUrl
            : null
        prevPageUrl = result.prevPageUrl
        if (result.statuses.length > 0) {
          nextStatuses = result.statuses
          break
        }
      }

      setCurrentStatusPagination({
        nextPageUrl: pageUrl,
        prevPageUrl
      })
      if (nextStatuses.length > 0) {
        setCurrentStatuses((previousStatuses) =>
          appendUniqueStatuses(previousStatuses, nextStatuses)
        )
      }
    } catch (_error) {
      setLoadMoreError(LOAD_MORE_ERROR_MESSAGE)
    } finally {
      isLoadingRef.current = false
      setLoadingMoreStatuses(false)
    }
  }, [
    actorId,
    currentStatusPagination.nextPageUrl,
    currentStatusPagination.prevPageUrl
  ])

  useEffect(() => {
    const loadMoreElement = loadMoreRef.current
    if (!loadMoreElement) return
    if (typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
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
  }, [loadMoreStatuses, canLoadMore])

  const renderFeed = (feedStatuses: Status[], emptyMessage: string) =>
    feedStatuses.length > 0 ? (
      <Posts
        host={host}
        currentTime={currentTime}
        statuses={feedStatuses}
        currentActor={currentActor}
        showActions={showActions}
        showReadOnlyStats={!showActions}
        isMediaUploadEnabled={isMediaUploadEnabled}
        postLineLimit={postLineLimit}
        onStatusCreated={handleStatusCreated}
        onPostUpdated={handlePostUpdated}
        onPostDeleted={handlePostDeleted}
        onLikeChanged={handleLikeChanged}
        onBookmarkChanged={handleBookmarkChanged}
      />
    ) : (
      <EmptyState>{emptyMessage}</EmptyState>
    )

  return (
    <div className="space-y-4">
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as ProfileTab)}
        className="w-full gap-4"
      >
        <TabsList className="w-full sm:w-fit" aria-label="Profile sections">
          <TabsTrigger value="posts" className="flex-1 sm:flex-none">
            Posts
          </TabsTrigger>
          <TabsTrigger value="replies" className="flex-1 sm:flex-none">
            Replies
          </TabsTrigger>
          <TabsTrigger value="media" className="flex-1 sm:flex-none">
            Media
          </TabsTrigger>
          {showFitnessTab && (
            <TabsTrigger value="fitness" className="flex-1 sm:flex-none">
              Fitness
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="posts" className="mt-0">
          {renderFeed(postStatuses, 'No posts yet')}
        </TabsContent>

        <TabsContent value="replies" className="mt-0">
          {renderFeed(replyStatuses, 'No replies yet')}
        </TabsContent>

        <TabsContent value="media" className="mt-0">
          {attachments.length > 0 ? (
            <div className="rounded-xl border bg-card p-2 shadow-sm sm:p-4">
              <ActorMediaGallery
                actorId={actorId}
                initialAttachments={attachments}
              />
            </div>
          ) : (
            <EmptyState>No media yet</EmptyState>
          )}
        </TabsContent>

        {showFitnessTab && (
          <TabsContent value="fitness" className="mt-0 space-y-4">
            {isCurrentUser && (
              <div className="flex justify-end">
                <Button variant="outline" asChild>
                  <Link href="/fitness">
                    <Activity className="size-4" aria-hidden="true" />
                    Fitness dashboard
                  </Link>
                </Button>
              </div>
            )}
            {renderFeed(fitnessStatuses, 'No fitness activities yet')}
          </TabsContent>
        )}
      </Tabs>

      {canLoadMore && (
        <div ref={loadMoreRef} className="text-center">
          {loadMoreError && (
            <p className="mb-3 text-sm text-destructive" role="alert">
              {loadMoreError}
            </p>
          )}
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
