'use client'

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
}

const LOAD_MORE_PAGE_LIMIT = 5
const LOAD_MORE_ERROR_MESSAGE = 'Failed to load more posts. Please try again.'

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

export const ActorTimelines: FC<Props> = ({
  host,
  actorId,
  currentTime,
  statuses,
  attachments,
  statusPagination,
  postLineLimit
}) => {
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

  const postStatuses = useMemo(
    () => currentStatuses.filter((status) => !isReply(status)),
    [currentStatuses]
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
  }, [loadMoreStatuses])

  return (
    <Tabs defaultValue="posts" className="w-full">
      <TabsList className="grid w-full grid-cols-3 rounded-none border-b bg-muted/40 p-1">
        <TabsTrigger
          value="posts"
          className="rounded-md data-[state=active]:bg-background"
        >
          Posts
        </TabsTrigger>
        <TabsTrigger
          value="replies"
          className="rounded-md data-[state=active]:bg-background"
        >
          Posts & Replies
        </TabsTrigger>
        <TabsTrigger
          value="media"
          className="rounded-md data-[state=active]:bg-background"
        >
          Media
        </TabsTrigger>
      </TabsList>

      <TabsContent value="posts" className="mt-0">
        {postStatuses.length > 0 ? (
          <Posts
            host={host}
            framed={false}
            currentTime={currentTime}
            statuses={postStatuses}
            postLineLimit={postLineLimit}
          />
        ) : (
          <p className="p-8 text-center text-muted-foreground">No posts yet</p>
        )}
      </TabsContent>

      <TabsContent value="replies" className="mt-0">
        <Posts
          host={host}
          framed={false}
          currentTime={currentTime}
          statuses={currentStatuses}
          postLineLimit={postLineLimit}
        />
      </TabsContent>

      <TabsContent value="media" className="mt-0">
        {attachments.length > 0 ? (
          <div className="p-2 sm:p-4">
            <ActorMediaGallery
              actorId={actorId}
              initialAttachments={attachments}
            />
          </div>
        ) : (
          <p className="p-8 text-center text-muted-foreground">
            No media posts yet
          </p>
        )}
      </TabsContent>
      {currentStatusPagination.nextPageUrl && (
        <div ref={loadMoreRef} className="border-t p-4 text-center">
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
    </Tabs>
  )
}
