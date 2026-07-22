'use client'

import { ArrowLeft, Pencil } from 'lucide-react'
import Link from 'next/link'
import { FC, useCallback, useRef, useState } from 'react'

import { getListTimeline } from '@/lib/client'
import { PageHeader } from '@/lib/components/page-header'
import { Posts } from '@/lib/components/posts/posts'
import { useLoadMoreOnVisible } from '@/lib/components/posts/useLoadMoreOnVisible'
import { ScrollToTopButton } from '@/lib/components/scroll-to-top-button'
import { Button } from '@/lib/components/ui/button'
import { PostLineLimit } from '@/lib/types/database/rows'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
import { ListEntity } from '@/lib/types/mastodon/list'

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

  const removeStatus = (status: Status) => {
    setCurrentStatuses((previousStatuses) =>
      previousStatuses.filter((item) => item.id !== status.id)
    )
  }

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
        title={
          <span className="flex items-center gap-2">
            <Link
              href="/lists"
              aria-label="Back to lists"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <span className="truncate">{list.title}</span>
          </span>
        }
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
          onPostDeleted={removeStatus}
        />
      ) : (
        <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground shadow-sm">
          <h2 className="mb-2 text-xl font-semibold">No posts yet</h2>
          <p>
            Posts from this list&rsquo;s members will appear here. Add accounts
            from the list settings to get started.
          </p>
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
