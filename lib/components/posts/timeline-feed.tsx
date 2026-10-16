'use client'

import { useRouter } from 'next/navigation'
import { FC, Fragment, ReactNode, useCallback, useMemo, useState } from 'react'

import { getAlbumsOwnerId } from '@/lib/components/gallery/mediaAlbumsUi'
import { OwnPostMediasModal } from '@/lib/components/medias-modal/own-post-medias-modal'
import { PostLineLimit } from '@/lib/types/database/rows'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import { Status, StatusNote, StatusPoll } from '@/lib/types/domain/status'
import { Tag } from '@/lib/types/domain/tag'
import {
  TimelineContext,
  TimelineParentPreview
} from '@/lib/types/domain/timeline'
import { StatusReaction } from '@/lib/types/mastodon/statusReaction'
import { cn } from '@/lib/utils'
import { getStatusDetailPathClient } from '@/lib/utils/getStatusDetailPathClient'
import { getActualStatus } from '@/lib/utils/text/processStatusText'

import { TimelineGapRow } from './TimelineGapRow'
import { BoostCarousel } from './boost-carousel'
import { CombinedPostListItem } from './combined-post-list-item'
import {
  CombinedBlock,
  buildCombinedBlocks,
  hasCombinedRun
} from './combinedThreadModel'
import { MOBILE_FEED_SURFACE_CLASS, POST_LIST_FRAME_CLASS } from './feedLayout'
import { PostListItem } from './post-list-item'
import { getStatusReplyTargetId, groupTimelinePage } from './timelineModel'
import { useInlineComposer } from './useInlineComposer'

export interface TimelineFeedProps {
  host: string
  className?: string
  /**
   * When true (default) the feed renders in the post list frame (see
   * `Posts`).
   */
  framed?: boolean
  currentActor?: ActorProfile
  showActions?: boolean
  /**
   * Render non-interactive engagement counts (reply/boost/like) under each post
   * instead of action buttons. For read-only previews like the logged-out
   * landing feed. Ignored when `showActions` is on.
   */
  showReadOnlyStats?: boolean
  currentTime: number
  statuses: Status[]
  timelineContext?: TimelineContext
  isMediaUploadEnabled?: boolean
  postLineLimit?: PostLineLimit
  onStatusCreated?: (status: Status) => void
  onReplyCreated?: (status: Status) => void
  onPostUpdated?: (status: Status) => void
  onPostDeleted?: (status: Status) => void
  onBookmarkChanged?: (
    status: StatusNote | StatusPoll,
    isBookmarked: boolean
  ) => void
  onLikeChanged?: (status: StatusNote | StatusPoll, isLiked: boolean) => void
  onReactionsChanged?: (
    status: StatusNote | StatusPoll,
    reactions: StatusReaction[]
  ) => void
  onReply?: (status: Status) => void
  onBoost?: (status: Status) => void
  onLike?: (status: Status) => void
  onBookmark?: (status: Status) => void
  onDelete?: (status: Status) => void
  /**
   * When true, eligible consecutive boosts are grouped into a carousel.
   * Defaults to false (boosts stay as individual timeline rows).
   */
  readingGroupBoosts?: boolean
  gapAfterStatusIds?: Record<string, number>
  loadingGapSegmentIndex?: number | null
  onLoadGap?: (segmentIndex: number) => void
}

export const TimelineFeed: FC<TimelineFeedProps> = ({
  host,
  className,
  framed = true,
  currentActor,
  showActions = false,
  showReadOnlyStats = false,
  currentTime,
  statuses,
  timelineContext,
  isMediaUploadEnabled,
  postLineLimit,
  onStatusCreated,
  onReplyCreated,
  onPostUpdated,
  onPostDeleted,
  onBookmarkChanged,
  onLikeChanged,
  onReactionsChanged,
  onReply,
  onBoost,
  onLike,
  onBookmark,
  onDelete,
  readingGroupBoosts = false,
  gapAfterStatusIds,
  loadingGapSegmentIndex,
  onLoadGap
}) => {
  const router = useRouter()
  const [modalMedias, setModalMedias] = useState<{
    medias: Attachment[]
    tags?: Tag[]
    initialSelection: number
    /** The viewer's actor id when the post is their own (the albums pill). */
    albumsOwnerId: string | null
  } | null>(null)
  const composer = useInlineComposer()
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(
    () => new Set()
  )

  // Rows the viewer switched from the combined layout back to separate posts
  // (the combined post's "Show as separate posts" menu item), keyed by the
  // row's root status id. `row.key` lists every id in the row, so it changes
  // whenever a reply is added, deleted or paged in, and would flip the row back.
  const [separateRows, setSeparateRows] = useState<Set<string>>(() => new Set())
  const showRowSeparate = useCallback((rootId: string) => {
    setSeparateRows((prev) => new Set(prev).add(rootId))
  }, [])

  const toggleThreadExpanded = (key: string) => {
    setExpandedThreads((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const statusMap = useMemo(() => {
    const map = new Map<string, Status>()
    for (const status of statuses) {
      map.set(status.id, status)
    }
    return map
  }, [statuses])

  const rows = useMemo(() => {
    return groupTimelinePage(statuses, {
      groupBoosts: readingGroupBoosts
    })
  }, [statuses, readingGroupBoosts])

  // A thread or conversation row's quick self-replies, combined into runs. A
  // row with no run is absent, so it renders post by post exactly as before.
  const combinedBlocksByRow = useMemo(() => {
    const byRow = new Map<string, CombinedBlock[]>()
    for (const row of rows) {
      if (row.kind !== 'thread' && row.kind !== 'conversation') continue
      const rowStatuses = row.entryIds
        .map((id) => statusMap.get(id))
        .filter((s): s is Status => Boolean(s))
      const blocks = buildCombinedBlocks(rowStatuses)
      if (hasCombinedRun(blocks)) byRow.set(row.key, blocks)
    }
    return byRow
  }, [rows, statusMap])

  // Stable so memoized rows don't re-render when this list's state changes.
  const openStatus = useCallback(
    (status: Status) => {
      void (async () => {
        const detailPath = await getStatusDetailPathClient(status)
        if (detailPath) router.push(detailPath)
      })()
    },
    [router]
  )
  const showMedia = useCallback(
    (
      medias: Attachment[],
      index: number,
      actualStatus: StatusNote | StatusPoll
    ) => {
      setModalMedias({
        medias,
        tags: actualStatus.tags,
        initialSelection: index,
        albumsOwnerId: getAlbumsOwnerId(currentActor, actualStatus)
      })
    },
    [currentActor]
  )

  if (statuses.length === 0) return null

  const canCompose = Boolean(currentActor) && showActions

  const renderPostItem = (
    status: Status,
    options?: {
      showReplyContext?: boolean
      parentPreview?: TimelineParentPreview | null
    }
  ) => (
    <PostListItem
      key={status.id}
      status={status}
      host={host}
      currentTime={currentTime}
      currentActor={currentActor}
      showActions={showActions}
      showReadOnlyStats={showReadOnlyStats}
      postLineLimit={postLineLimit}
      showReplyContext={options?.showReplyContext}
      parentPreview={options?.parentPreview}
      canCompose={canCompose}
      activeComposer={
        currentActor && composer.active?.anchorId === status.id
          ? composer.active
          : null
      }
      isMediaUploadEnabled={isMediaUploadEnabled}
      openReply={composer.openReply}
      openQuote={composer.openQuote}
      openEdit={composer.openEdit}
      close={composer.close}
      onOpenStatus={openStatus}
      onShowMedia={showMedia}
      onStatusCreated={onStatusCreated}
      onReplyCreated={onReplyCreated}
      onPostUpdated={onPostUpdated}
      onPostDeleted={onPostDeleted}
      onBookmarkChanged={onBookmarkChanged}
      onLikeChanged={onLikeChanged}
      onReactionsChanged={onReactionsChanged}
    />
  )

  // The reply context a thread or conversation shows above its first post: the
  // post it answers, when that is not part of the row.
  const getLeadContext = (first: Status, entryIds: string[]) => {
    const replyTarget = getStatusReplyTargetId(getActualStatus(first))
    return {
      showReplyContext:
        Boolean(replyTarget) && !entryIds.includes(replyTarget!),
      parentPreview: replyTarget
        ? timelineContext?.ancestorsById?.[replyTarget]
        : undefined
    }
  }

  const renderCombinedBlocks = (
    rowRootId: string,
    entryIds: string[],
    blocks: CombinedBlock[]
  ) =>
    blocks.map((block, index) => {
      const lead =
        index === 0
          ? getLeadContext(
              block.kind === 'run' ? block.parts[0].status : block.status,
              entryIds
            )
          : { showReplyContext: false, parentPreview: undefined }
      if (block.kind === 'post') return renderPostItem(block.status, lead)

      // The composer may be anchored to any post of the run: a reply opened on
      // the visible last post of a collapsed thread stays open when the thread
      // expands into one combined post.
      const composerAnchored =
        composer.active !== null &&
        block.parts.some(
          (part) =>
            part.status.id === composer.active?.anchorId ||
            part.insets.some((inset) => inset.id === composer.active?.anchorId)
        )
      return (
        <CombinedPostListItem
          key={block.key}
          parts={block.parts}
          rowKey={rowRootId}
          host={host}
          currentTime={currentTime}
          currentActor={currentActor}
          showActions={showActions}
          showReadOnlyStats={showReadOnlyStats}
          postLineLimit={postLineLimit}
          showReplyContext={lead.showReplyContext}
          parentPreview={lead.parentPreview}
          canCompose={canCompose}
          activeComposer={
            currentActor && composerAnchored ? composer.active : null
          }
          isMediaUploadEnabled={isMediaUploadEnabled}
          openReply={composer.openReply}
          openQuote={composer.openQuote}
          openEdit={composer.openEdit}
          close={composer.close}
          onOpenStatus={openStatus}
          onShowMedia={showMedia}
          onShowSeparate={showRowSeparate}
          onStatusCreated={onStatusCreated}
          onReplyCreated={onReplyCreated}
          onPostUpdated={onPostUpdated}
          onPostDeleted={onPostDeleted}
          onBookmarkChanged={onBookmarkChanged}
          onLikeChanged={onLikeChanged}
          onReactionsChanged={onReactionsChanged}
        />
      )
    })

  return (
    <>
      <section
        className={cn(
          'w-full min-w-0 divide-y divide-border',
          framed && cn(POST_LIST_FRAME_CLASS, MOBILE_FEED_SURFACE_CLASS),
          className
        )}
      >
        {rows.map((row) => {
          let rowContent: ReactNode = null
          let rowStatusIds: string[] = []

          if (row.kind === 'status') {
            const status = statusMap.get(row.entryId)
            if (!status) return null

            rowStatusIds = [status.id]
            const actualStatus = getActualStatus(status)
            const replyTarget = getStatusReplyTargetId(actualStatus)
            const isReply = Boolean(replyTarget)
            const parentPreview = replyTarget
              ? timelineContext?.ancestorsById?.[replyTarget]
              : undefined

            rowContent = (
              <div
                key={row.key}
                data-status-id={status.id}
                data-row-status-ids={rowStatusIds.join(' ')}
                className={cn(
                  'min-h-0 min-w-0',
                  framed && 'first:rounded-t-lg last:rounded-b-lg'
                )}
              >
                {renderPostItem(status, {
                  showReplyContext: isReply,
                  parentPreview
                })}
              </div>
            )
          } else if (row.kind === 'thread') {
            const threadStatuses = row.entryIds
              .map((id) => statusMap.get(id))
              .filter((s): s is Status => Boolean(s))

            if (threadStatuses.length === 0) return null
            rowStatusIds = threadStatuses.map((s) => s.id)

            const isExpanded = expandedThreads.has(row.key)
            const shouldCollapse = threadStatuses.length > 3 && !isExpanded
            const combinedBlocks =
              shouldCollapse || separateRows.has(row.entryIds[0])
                ? undefined
                : combinedBlocksByRow.get(row.key)

            rowContent = (
              <div
                key={row.key}
                data-status-id={threadStatuses[0]?.id}
                data-row-status-ids={rowStatusIds.join(' ')}
                aria-label="Thread"
                className={cn(
                  'min-h-0 min-w-0 bg-muted/30 dark:bg-muted/15',
                  framed && 'first:rounded-t-lg last:rounded-b-lg'
                )}
              >
                {combinedBlocks ? (
                  renderCombinedBlocks(
                    row.entryIds[0],
                    row.entryIds,
                    combinedBlocks
                  )
                ) : shouldCollapse ? (
                  <>
                    {/* First post */}
                    {renderPostItem(threadStatuses[0], {
                      showReplyContext: (() => {
                        const replyTarget = getStatusReplyTargetId(
                          getActualStatus(threadStatuses[0])
                        )
                        return (
                          Boolean(replyTarget) &&
                          !row.entryIds.includes(replyTarget!)
                        )
                      })(),
                      parentPreview: (() => {
                        const replyTarget = getStatusReplyTargetId(
                          getActualStatus(threadStatuses[0])
                        )
                        return replyTarget
                          ? timelineContext?.ancestorsById?.[replyTarget]
                          : undefined
                      })()
                    })}

                    {/* Expander button */}
                    <div className="relative flex items-center gap-3 px-4 py-2">
                      <div className="flex shrink-0 items-center justify-center w-10">
                        <div className="size-2.5 rounded-full bg-muted-foreground/40" />
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleThreadExpanded(row.key)}
                        aria-expanded={false}
                        className="rounded px-1 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        Show {threadStatuses.length - 2} earlier posts in thread
                      </button>
                    </div>

                    {/* Last post */}
                    {renderPostItem(threadStatuses[threadStatuses.length - 1], {
                      showReplyContext: false
                    })}
                  </>
                ) : (
                  threadStatuses.map((status, index) => {
                    const isFirst = index === 0
                    const replyTarget = isFirst
                      ? getStatusReplyTargetId(getActualStatus(status))
                      : null
                    const showReplyContext =
                      Boolean(replyTarget) &&
                      !row.entryIds.includes(replyTarget!)
                    const parentPreview = replyTarget
                      ? timelineContext?.ancestorsById?.[replyTarget]
                      : undefined

                    return renderPostItem(status, {
                      showReplyContext,
                      parentPreview
                    })
                  })
                )}
              </div>
            )
          } else if (row.kind === 'conversation') {
            const convStatuses = row.entryIds
              .map((id) => statusMap.get(id))
              .filter((s): s is Status => Boolean(s))

            if (convStatuses.length === 0) return null
            rowStatusIds = convStatuses.map((s) => s.id)
            const combinedBlocks = separateRows.has(row.entryIds[0])
              ? undefined
              : combinedBlocksByRow.get(row.key)

            rowContent = (
              <div
                key={row.key}
                data-status-id={convStatuses[0]?.id}
                data-row-status-ids={rowStatusIds.join(' ')}
                aria-label="Conversation"
                className={cn(
                  'min-h-0 min-w-0 bg-muted/30 dark:bg-muted/15',
                  framed && 'first:rounded-t-lg last:rounded-b-lg'
                )}
              >
                {combinedBlocks
                  ? renderCombinedBlocks(
                      row.entryIds[0],
                      row.entryIds,
                      combinedBlocks
                    )
                  : convStatuses.map((status, index) => {
                      const isFirst = index === 0
                      const replyTarget = isFirst
                        ? getStatusReplyTargetId(getActualStatus(status))
                        : null
                      const showReplyContext =
                        Boolean(replyTarget) &&
                        !row.entryIds.includes(replyTarget!)
                      const parentPreview = replyTarget
                        ? timelineContext?.ancestorsById?.[replyTarget]
                        : undefined

                      return renderPostItem(status, {
                        showReplyContext,
                        parentPreview
                      })
                    })}
              </div>
            )
          } else if (row.kind === 'boosts') {
            const boostStatuses = row.entryIds
              .map((id) => statusMap.get(id))
              .filter((s): s is Status => Boolean(s))

            if (boostStatuses.length === 0) return null
            rowStatusIds = boostStatuses.map((s) => s.id)

            rowContent = (
              <div
                key={row.key}
                data-status-id={boostStatuses[0]?.id}
                data-row-status-ids={rowStatusIds.join(' ')}
              >
                <BoostCarousel
                  statuses={boostStatuses}
                  currentActor={currentActor}
                  onReply={onReply}
                  onBoost={onBoost}
                  onLike={onLike}
                  onBookmark={onBookmark}
                  onDelete={onDelete}
                />
              </div>
            )
          }

          if (!rowContent) return null

          let gapSegmentIndex: number | undefined
          if (gapAfterStatusIds) {
            for (const id of rowStatusIds) {
              if (gapAfterStatusIds[id] !== undefined) {
                gapSegmentIndex = gapAfterStatusIds[id]
                break
              }
            }
          }

          return (
            <Fragment key={row.key}>
              {rowContent}
              {gapSegmentIndex !== undefined && onLoadGap ? (
                <TimelineGapRow
                  segmentIndex={gapSegmentIndex}
                  isLoading={loadingGapSegmentIndex === gapSegmentIndex}
                  onLoadGap={onLoadGap}
                />
              ) : null}
            </Fragment>
          )
        })}
      </section>
      <OwnPostMediasModal
        medias={modalMedias?.medias ?? null}
        tags={modalMedias?.tags ?? null}
        initialSelection={modalMedias?.initialSelection ?? 0}
        albumsOwnerId={modalMedias?.albumsOwnerId}
        onClosed={() => setModalMedias(null)}
      />
    </>
  )
}
