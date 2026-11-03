'use client'

import {
  FC,
  Fragment,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import { getAlbumsOwnerId } from '@/lib/components/gallery/mediaAlbumsUi'
import { OwnPostMediasModal } from '@/lib/components/medias-modal/own-post-medias-modal'
import { useOpenStatusPath } from '@/lib/components/posts/useOpenStatusPath'
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
import { getVisibility } from '@/lib/utils/getVisibility'
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
import { PRIORITY_ROW_WINDOW, showsPrioritizableMedia } from './posts'
import {
  TimelineRow,
  getStatusAliases,
  getStatusReplyTargetId,
  groupTimelinePage
} from './timelineModel'
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
  /**
   * Reveal the list's first picture without the hydration fade, as `Posts`
   * does (see its prop of the same name), picked from the rows as they render:
   * the first post with an ordinary image among the first rows' leading posts
   * (every part of a combined card that leads its row). Off by default.
   */
  prioritizeFirstMedia?: boolean
  /**
   * Parent previews for reply context. Without it a reply whose parent is not
   * in its row shows the generic "In reply to a post" line.
   */
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

// A reply-context preview of a status already loaded in the feed.
const previewFromStatus = (
  status: Status
): TimelineParentPreview | undefined => {
  const actual = getActualStatus(status)
  const actor = actual.actor
  if (!actor) return undefined
  const spoilerText = actual.summary?.trim() || undefined
  const isSensitive = Boolean(actual.sensitive) || Boolean(spoilerText)
  return {
    id: actual.id,
    url: actual.url,
    actor: {
      id: actor.id,
      username: actor.username,
      domain: actor.domain,
      name: actor.name ?? undefined,
      avatarUrl: actor.iconUrl ?? undefined
    },
    contentHtml: isSensitive ? '' : actual.text,
    text: isSensitive ? '' : actual.text,
    tags: actual.tags,
    isLocalActor: actual.isLocalActor,
    spoilerText,
    isSensitive,
    createdAt: new Date(actual.createdAt).toISOString(),
    visibility: getVisibility(actual.to, actual.cc)
  }
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
  prioritizeFirstMedia = false,
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
  const openStatusPath = useOpenStatusPath()
  const [modalMedias, setModalMedias] = useState<{
    medias: Attachment[]
    tags?: Tag[]
    initialSelection: number
    /** The viewer's actor id when the post is their own (the albums pill). */
    albumsOwnerId: string | null
  } | null>(null)
  const composer = useInlineComposer(Boolean(currentActor) && showActions)
  // Threads the viewer expanded, stored as every status id of the row (like
  // `separateRows` below): a row's key changes whenever a part is added, so
  // keying by it would collapse a thread right after the viewer replied to it.
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(
    () => new Set()
  )
  // Root ids of thread rows that rendered in full (three posts or fewer). A row
  // that grows past three parts at its newest end stays in full instead of
  // collapsing under the reader; one that gains older parts (a new root) is a
  // different row and collapses as usual.
  const renderedInFull = useRef<Set<string>>(new Set())
  const isThreadExpanded = (entryIds: string[]) =>
    entryIds.some((id) => expandedThreads.has(id)) ||
    renderedInFull.current.has(entryIds[0])

  // Rows the viewer switched from the combined layout back to separate posts
  // (the combined post's "Show as separate posts" menu item). Every status id
  // of the row is stored, because `row.key` changes whenever a reply is added,
  // deleted or paged in and the row's first id can disappear (the root deleted,
  // or an older parent paged in); any remaining id still finds the choice.
  const [separateRows, setSeparateRows] = useState<Set<string>>(() => new Set())
  const isRowSeparate = (entryIds: string[]) =>
    entryIds.some((id) => separateRows.has(id))
  const focusAfterSeparate = useRef<string | null>(null)
  const showRowSeparate = useCallback((entryIds: string[]) => {
    focusAfterSeparate.current = entryIds[0] ?? null
    setSeparateRows((prev) => {
      const next = new Set(prev)
      entryIds.forEach((id) => next.add(id))
      return next
    })
  }, [])
  // The combined article that held focus is gone once the row splits: move
  // focus to the row's first post instead of letting it fall to <body>.
  useEffect(() => {
    const id = focusAfterSeparate.current
    if (!id) return
    focusAfterSeparate.current = null
    const rows = document.querySelectorAll<HTMLElement>('[data-row-status-ids]')
    for (const row of rows) {
      if (row.dataset.rowStatusIds?.split(' ').includes(id)) {
        row.focus()
        return
      }
    }
  }, [separateRows])

  const toggleThreadExpanded = (entryIds: string[]) => {
    setExpandedThreads((prev) => {
      const next = new Set(prev)
      if (entryIds.some((id) => next.has(id))) {
        entryIds.forEach((id) => next.delete(id))
      } else {
        entryIds.forEach((id) => next.add(id))
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

  useEffect(() => {
    for (const row of rows) {
      if (row.kind === 'thread' && row.entryIds.length <= 3) {
        renderedInFull.current.add(row.entryIds[0])
      }
    }
  }, [rows])

  // A thread or conversation row's self-replies, combined into runs. A
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
        if (detailPath) openStatusPath(detailPath)
      })()
    },
    [openStatusPath]
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

  const getRowStatuses = (entryIds: string[]) =>
    entryIds
      .map((id) => statusMap.get(id))
      .filter((s): s is Status => Boolean(s))

  // The combined blocks a thread or conversation row renders right now, or
  // undefined when it renders post by post: a collapsed long thread, a row
  // the viewer split, or a row with no run.
  const getShownCombinedBlocks = (
    row: Extract<TimelineRow, { kind: 'thread' | 'conversation' }>,
    rowStatusCount: number
  ) => {
    if (isRowSeparate(row.entryIds)) return undefined
    if (
      row.kind === 'thread' &&
      rowStatusCount > 3 &&
      !isThreadExpanded(row.entryIds)
    ) {
      return undefined
    }
    return combinedBlocksByRow.get(row.key)
  }

  // The posts at the top of a row, in the order they render: its first post,
  // or every part of the combined card that leads it. A boost carousel offers
  // none.
  const getRowLeadStatuses = (row: TimelineRow): Status[] => {
    if (row.kind === 'status') {
      const status = statusMap.get(row.entryId)
      return status ? [status] : []
    }
    if (row.kind === 'boosts') return []
    const rowStatuses = getRowStatuses(row.entryIds)
    const firstBlock = getShownCombinedBlocks(row, rowStatuses.length)?.[0]
    if (firstBlock?.kind === 'run') {
      return firstBlock.parts.map((part) => part.status)
    }
    if (firstBlock) return [firstBlock.status]
    return rowStatuses.slice(0, 1)
  }

  // `Posts`' pick, over the rows as rendered rather than the flat list: a row
  // sits at its newest part's place but shows its oldest part first.
  const prioritizedStatusId = prioritizeFirstMedia
    ? (rows
        .filter((row) =>
          row.kind === 'status'
            ? statusMap.has(row.entryId)
            : row.entryIds.some((id) => statusMap.has(id))
        )
        .slice(0, PRIORITY_ROW_WINDOW)
        .flatMap(getRowLeadStatuses)
        .find(showsPrioritizableMedia)?.id ?? null)
    : null

  const canCompose = Boolean(currentActor) && showActions

  // A row's key must survive parts being added to it, or its state (an
  // expanded long post, a translation, an open edit history, focus) is thrown
  // away on every reply, refresh or page load. `row.key` joins every id, so it
  // changes each time. The first id of a thread or conversation is its root,
  // the oldest post: replies and refreshes only ever add newer parts, so it
  // stays put; it moves only when older parents page in, which is rare and
  // unavoidable. A boost carousel keeps its own key.
  const getStableRowKey = (row: TimelineRow) => {
    if (row.kind === 'status') return `row:${row.entryId}`
    if (row.kind === 'boosts') return row.key
    return `row:${row.entryIds[0]}`
  }

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
      prioritizeMedia={status.id === prioritizedStatusId}
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

  // The reply context of a block after the first: a post split off a run (a late
  // reply from someone else, a sibling self-reply, the author answering a
  // tucked-in reply) would otherwise read as a reply to the block above it.
  // `getTimelineContext` gives no preview for a parent on the same page, so the
  // preview is built from the loaded parent. The line is skipped when the
  // parent is the post directly above (its last part, for a run).
  const getContextAfter = (
    first: Status,
    above: Status,
    entryIds: string[]
  ) => {
    const replyTarget = getStatusReplyTargetId(getActualStatus(first))
    if (!replyTarget)
      return { showReplyContext: false, parentPreview: undefined }
    const parent = getRowStatuses(entryIds).find((status) =>
      getStatusAliases(getActualStatus(status)).includes(replyTarget)
    )
    if (parent && parent.id === above.id) {
      return { showReplyContext: false, parentPreview: undefined }
    }
    return {
      showReplyContext: true,
      parentPreview:
        timelineContext?.ancestorsById?.[replyTarget] ??
        (parent ? previewFromStatus(parent) : undefined)
    }
  }

  const getLaterBlockContext = (
    block: CombinedBlock,
    previous: CombinedBlock,
    entryIds: string[]
  ) =>
    getContextAfter(
      block.kind === 'run' ? block.parts[0].status : block.status,
      previous.kind === 'run'
        ? previous.parts[previous.parts.length - 1].status
        : previous.status,
      entryIds
    )

  // The post-by-post rendering of a row: the first post shows the context of
  // what the row answers, every later one that of a parent not directly above.
  const renderRowPosts = (statuses: Status[], entryIds: string[]) =>
    statuses.map((status, index) =>
      renderPostItem(
        status,
        index === 0
          ? getLeadContext(status, entryIds)
          : getContextAfter(status, statuses[index - 1], entryIds)
      )
    )

  const renderCombinedBlocks = (entryIds: string[], blocks: CombinedBlock[]) =>
    blocks.map((block, index) => {
      const lead =
        index === 0
          ? getLeadContext(
              block.kind === 'run' ? block.parts[0].status : block.status,
              entryIds
            )
          : getLaterBlockContext(block, blocks[index - 1], entryIds)
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
          rowIds={entryIds}
          prioritizeMedia={block.parts.some(
            (part) => part.status.id === prioritizedStatusId
          )}
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
          const rowKey = getStableRowKey(row)
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
                key={rowKey}
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
            const threadStatuses = getRowStatuses(row.entryIds)

            if (threadStatuses.length === 0) return null
            rowStatusIds = threadStatuses.map((s) => s.id)

            const isExpanded = isThreadExpanded(row.entryIds)
            const shouldCollapse = threadStatuses.length > 3 && !isExpanded
            const combinedBlocks = getShownCombinedBlocks(
              row,
              threadStatuses.length
            )

            rowContent = (
              <div
                key={rowKey}
                data-status-id={threadStatuses[0]?.id}
                data-row-status-ids={rowStatusIds.join(' ')}
                role="group"
                aria-label="Thread"
                tabIndex={-1}
                className={cn(
                  'min-h-0 min-w-0 bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 dark:bg-muted/15',
                  framed && 'first:rounded-t-lg last:rounded-b-lg'
                )}
              >
                {combinedBlocks ? (
                  renderCombinedBlocks(row.entryIds, combinedBlocks)
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
                        onClick={() => toggleThreadExpanded(row.entryIds)}
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
                  renderRowPosts(threadStatuses, row.entryIds)
                )}
              </div>
            )
          } else if (row.kind === 'conversation') {
            const convStatuses = getRowStatuses(row.entryIds)

            if (convStatuses.length === 0) return null
            rowStatusIds = convStatuses.map((s) => s.id)
            const combinedBlocks = getShownCombinedBlocks(
              row,
              convStatuses.length
            )

            rowContent = (
              <div
                key={rowKey}
                data-status-id={convStatuses[0]?.id}
                data-row-status-ids={rowStatusIds.join(' ')}
                role="group"
                aria-label="Conversation"
                tabIndex={-1}
                className={cn(
                  'min-h-0 min-w-0 bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 dark:bg-muted/15',
                  framed && 'first:rounded-t-lg last:rounded-b-lg'
                )}
              >
                {combinedBlocks
                  ? renderCombinedBlocks(row.entryIds, combinedBlocks)
                  : renderRowPosts(convStatuses, row.entryIds)}
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
                key={rowKey}
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
            <Fragment key={rowKey}>
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
