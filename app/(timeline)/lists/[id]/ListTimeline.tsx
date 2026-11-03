'use client'

import { List, Pencil } from 'lucide-react'
import Link from 'next/link'
import { FC, useCallback, useRef, useState } from 'react'

import { getListTimeline } from '@/lib/client'
import { LoadMoreButton } from '@/lib/components/load-more-button/load-more-button'
import { PageHeader } from '@/lib/components/page-header'
import {
  removeOriginalStatus,
  updateMatchingStatus
} from '@/lib/components/posts/statusArray'
import { TimelineFeed } from '@/lib/components/posts/timeline-feed'
import {
  initialTimelineContext,
  mergeTimelineContext
} from '@/lib/components/posts/timelineContext'
import { getStatusReplyTargetId } from '@/lib/components/posts/timelineModel'
import { useLoadMoreOnVisible } from '@/lib/components/posts/useLoadMoreOnVisible'
import { ScrollToTopButton } from '@/lib/components/scroll-to-top-button'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { Button } from '@/lib/components/ui/button'
import { PostLineLimit } from '@/lib/types/database/rows'
import { ActorProfile } from '@/lib/types/domain/actor'
import {
  Status,
  StatusNote,
  StatusPoll,
  getOriginalStatus
} from '@/lib/types/domain/status'
import { TimelineContext } from '@/lib/types/domain/timeline'
import { ListEntity } from '@/lib/types/mastodon/list'
import { StatusReaction } from '@/lib/types/mastodon/statusReaction'

interface ListTimelineProps {
  host: string
  list: ListEntity
  memberCount: number
  statuses: Status[]
  /** Parent previews for the first page's replies, as the home timeline has. */
  timelineContext?: TimelineContext
  currentTime: number
  currentActor: ActorProfile
  isMediaUploadEnabled?: boolean
  postLineLimit?: PostLineLimit
}

const listSubtitle = (list: ListEntity, memberCount: number) => {
  const members = `${memberCount} member${memberCount === 1 ? '' : 's'}`
  return `${members} · Replies: ${list.replies_policy}`
}

export const ListTimeline: FC<ListTimelineProps> = ({
  host,
  list,
  memberCount,
  statuses,
  timelineContext,
  currentTime,
  currentActor,
  isMediaUploadEnabled,
  postLineLimit
}) => {
  const [currentStatuses, setCurrentStatuses] = useState<Status[]>(statuses)
  const [currentTimelineContext, setCurrentTimelineContext] =
    useState<TimelineContext>(() => initialTimelineContext(timelineContext))
  const [hasMoreStatuses, setHasMoreStatuses] = useState<boolean>(
    statuses.length > 0
  )
  const [isLoadingMoreStatuses, setLoadingMoreStatuses] =
    useState<boolean>(false)
  const isLoadingRef = useRef<boolean>(false)
  const lastStatusIdRef = useRef<string | null>(
    statuses.length > 0 ? statuses[statuses.length - 1].id : null
  )

  const onPostDeleted = useCallback((status: Status) => {
    setCurrentStatuses((previousStatuses) =>
      removeOriginalStatus(previousStatuses, status.id)
    )
  }, [])

  // A reply written inline from a row: count it on its parent and insert it
  // right after the parent, as the home timeline does, so it shows (and joins a
  // combined card) without a reload. A reply whose parent is not in the list
  // is the viewer's own post to someone outside it and does not belong here.
  const onReplyCreated = useCallback((reply: Status) => {
    const original = getOriginalStatus(reply)
    const parentId = getStatusReplyTargetId(original)
    if (!parentId) return
    setCurrentStatuses((previousStatuses) => {
      const matchesParent = (status: Status) => {
        const actual = getOriginalStatus(status)
        return (
          status.id === parentId ||
          actual.id === parentId ||
          actual.url === parentId ||
          actual.publicId === parentId
        )
      }
      const parentIndex = previousStatuses.findIndex(matchesParent)
      if (parentIndex === -1) return previousStatuses
      if (previousStatuses.some((status) => status.id === reply.id)) {
        return previousStatuses
      }
      const next = updateMatchingStatus(
        previousStatuses,
        getOriginalStatus(previousStatuses[parentIndex]).id,
        (target) => ({
          ...target,
          totalReplies: (target.totalReplies ?? 0) + 1,
          replies: target.replies ? [...target.replies, reply] : [reply]
        })
      )
      next.splice(parentIndex + 1, 0, reply)
      return next
    })
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
    const maxStatusId = lastStatusIdRef.current
    if (isLoadingRef.current || !maxStatusId) return

    isLoadingRef.current = true
    setLoadingMoreStatuses(true)
    try {
      const result = await getListTimeline({
        listId: list.id,
        maxStatusId
      })
      if (result.statuses.length === 0) {
        setHasMoreStatuses(false)
        return
      }
      lastStatusIdRef.current = result.statuses[result.statuses.length - 1].id
      setHasMoreStatuses(Boolean(result.nextMaxStatusId))
      setCurrentTimelineContext((previous) =>
        mergeTimelineContext(previous, result.context)
      )
      setCurrentStatuses((previousStatuses) => [
        ...previousStatuses,
        ...result.statuses
      ])
    } catch (_error) {
      // Error loading more - user can retry by clicking the button
    } finally {
      isLoadingRef.current = false
      setLoadingMoreStatuses(false)
    }
  }, [list.id])

  const { loadMoreRef, isLoadMoreVisible } = useLoadMoreOnVisible({
    enabled: hasMoreStatuses,
    onLoadMore: loadMoreStatuses
  })

  return (
    <div className="space-y-6">
      <ScrollToTopButton
        isLoadMoreVisible={hasMoreStatuses && isLoadMoreVisible}
      />
      <PageHeader
        title={list.title}
        compactTitle="Lists"
        back={{ href: '/lists', accessibleName: 'Back to lists' }}
        description={listSubtitle(list, memberCount)}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`/lists/${list.id}/edit`}>
              <Pencil className="h-4 w-4" />
              Edit
            </Link>
          </Button>
        }
      />

      {currentStatuses.length > 0 ? (
        // The home timeline's feed and grouping, so a member's self-replies
        // combine into one card as on Home. Boosts stay individual cards (the
        // carousel is the home timeline's reading preference).
        <TimelineFeed
          host={host}
          currentTime={currentTime}
          statuses={currentStatuses}
          timelineContext={currentTimelineContext}
          currentActor={currentActor}
          showActions
          isMediaUploadEnabled={isMediaUploadEnabled}
          postLineLimit={postLineLimit}
          onPostDeleted={onPostDeleted}
          onReplyCreated={onReplyCreated}
          onPostUpdated={onPostUpdated}
          onLikeChanged={onLikeChanged}
          onBookmarkChanged={onBookmarkChanged}
          onReactionsChanged={onReactionsChanged}
        />
      ) : (
        <EmptyState
          icon={List}
          titleAs="h2"
          title="No posts yet"
          action={
            // Only an empty list needs people added; one with members is
            // waiting on them to post.
            memberCount === 0 ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/lists/${list.id}/edit`}>Add people</Link>
              </Button>
            ) : undefined
          }
        >
          {memberCount === 0
            ? 'Add people to this list to see their posts here.'
            : 'Posts from this list\u2019s members will appear here.'}
        </EmptyState>
      )}

      {hasMoreStatuses && lastStatusIdRef.current && (
        <LoadMoreButton
          containerRef={loadMoreRef}
          isLoading={isLoadingMoreStatuses}
          onClick={loadMoreStatuses}
        />
      )}
    </div>
  )
}
