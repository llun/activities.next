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
import { Status, StatusType } from '@/lib/types/domain/status'

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

  // The outbox cursor only feeds the post/reply feeds, so the standalone load
  // more control is hidden on the media and fitness tabs.
  const canLoadMore =
    Boolean(currentStatusPagination.nextPageUrl) &&
    (activeTab === 'posts' || activeTab === 'replies')

  const handleReplyCreated = useCallback(() => {
    // A reply created from this profile's inline composer is the viewer's own
    // status; it doesn't belong in the viewed actor's feed, so nothing is
    // inserted here. The composer closes itself after posting.
  }, [])

  const handlePostDeleted = useCallback((status: Status) => {
    setCurrentStatuses((previousStatuses) =>
      previousStatuses.filter((item) => item.id !== status.id)
    )
  }, [])

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
        onReplyCreated={handleReplyCreated}
        onPostDeleted={handlePostDeleted}
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
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="posts">Posts</TabsTrigger>
          <TabsTrigger value="replies">Replies</TabsTrigger>
          <TabsTrigger value="media">Media</TabsTrigger>
          {showFitnessTab && <TabsTrigger value="fitness">Fitness</TabsTrigger>}
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
                    <Activity className="size-4" />
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
