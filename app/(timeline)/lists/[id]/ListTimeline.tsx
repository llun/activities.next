'use client'

import { List, Pencil } from 'lucide-react'
import Link from 'next/link'
import { FC, useCallback, useRef, useState } from 'react'

import { getListTimeline } from '@/lib/client'
import { LoadMoreButton } from '@/lib/components/load-more-button/load-more-button'
import { PageHeader } from '@/lib/components/page-header'
import { Posts } from '@/lib/components/posts/posts'
import {
  removeOriginalStatus,
  updateMatchingStatus
} from '@/lib/components/posts/statusArray'
import { useLoadMoreOnVisible } from '@/lib/components/posts/useLoadMoreOnVisible'
import { ScrollToTopButton } from '@/lib/components/scroll-to-top-button'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { Button } from '@/lib/components/ui/button'
import { PostLineLimit } from '@/lib/types/database/rows'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Status, StatusNote, StatusPoll } from '@/lib/types/domain/status'
import { ListEntity } from '@/lib/types/mastodon/list'
import { StatusReaction } from '@/lib/types/mastodon/statusReaction'

interface ListTimelineProps {
  host: string
  list: ListEntity
  memberCount: number
  statuses: Status[]
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
  currentTime,
  currentActor,
  isMediaUploadEnabled,
  postLineLimit
}) => {
  const [currentStatuses, setCurrentStatuses] = useState<Status[]>(statuses)
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
