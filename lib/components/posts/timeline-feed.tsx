'use client'

import { useRouter } from 'next/navigation'
import { FC, useMemo, useState } from 'react'

import { MediasModal } from '@/lib/components/medias-modal/medias-modal'
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

import { BoostCarousel } from './boost-carousel'
import { MOBILE_FEED_SURFACE_CLASS } from './feedLayout'
import { InlineStatusComposer } from './inline-status-composer'
import { Post } from './post'
import { StatusConnectorRail } from './status-context'
import { getStatusReplyTargetId, groupTimelinePage } from './timelineModel'
import { useInlineComposer } from './useInlineComposer'

export interface TimelineFeedProps {
  host: string
  className?: string
  /**
   * When true (default) the feed renders as a self-contained bordered card.
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
  readingGroupBoosts = false
}) => {
  const router = useRouter()
  const [modalMedias, setModalMedias] = useState<{
    medias: Attachment[]
    tags?: Tag[]
    initialSelection: number
  } | null>(null)
  const composer = useInlineComposer()
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(
    () => new Set()
  )

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

  if (statuses.length === 0) return null

  const openStatus = (status: Status) => {
    void (async () => {
      const detailPath = await getStatusDetailPathClient(status)
      if (detailPath) router.push(detailPath)
    })()
  }

  const canCompose = Boolean(currentActor) && showActions

  const renderPostItem = (
    status: Status,
    options?: {
      connectorPosition?: 'first' | 'middle' | 'last' | 'single'
      showReplyContext?: boolean
      parentPreview?: TimelineParentPreview | null
    }
  ) => {
    const actualStatus = getActualStatus(status)
    const activeComposer =
      currentActor && composer.active?.anchorId === status.id
        ? composer.active
        : null

    return (
      <article key={status.id} className="min-h-0 min-w-0 px-4 py-3">
        <Post
          host={host}
          currentTime={currentTime}
          currentActor={currentActor}
          status={status}
          showActions={showActions}
          showReadOnlyStats={showReadOnlyStats}
          editable={currentActor?.id === actualStatus.actorId}
          collapsible
          postLineLimit={postLineLimit}
          connectorPosition={options?.connectorPosition}
          showReplyContext={options?.showReplyContext}
          parentPreview={options?.parentPreview}
          onReply={
            canCompose
              ? (target) => composer.openReply(target, status.id)
              : undefined
          }
          onEdit={
            canCompose
              ? (target) => composer.openEdit(target, status.id)
              : undefined
          }
          onQuote={
            canCompose
              ? (target) => composer.openQuote(target, status.id)
              : undefined
          }
          onPostDeleted={onPostDeleted}
          onBookmarkChanged={onBookmarkChanged}
          onLikeChanged={onLikeChanged}
          onReactionsChanged={onReactionsChanged}
          onOpenStatus={openStatus}
          onShowAttachment={(allMedias, index) => {
            setModalMedias({
              medias: allMedias,
              tags: actualStatus.tags,
              initialSelection: index
            })
          }}
        />
        {activeComposer && currentActor ? (
          <InlineStatusComposer
            key={`${activeComposer.mode}-${activeComposer.anchorId}`}
            host={host}
            profile={currentActor}
            mode={activeComposer.mode}
            status={activeComposer.status}
            isMediaUploadEnabled={isMediaUploadEnabled}
            onCancel={composer.close}
            onReplyCreated={onReplyCreated}
            onCreated={onStatusCreated}
            onUpdated={onPostUpdated}
          />
        ) : null}
      </article>
    )
  }

  return (
    <>
      <section
        className={cn(
          'w-full min-w-0 divide-y divide-border',
          framed &&
            cn(
              'rounded-xl border bg-card shadow-sm',
              MOBILE_FEED_SURFACE_CLASS
            ),
          className
        )}
      >
        {rows.map((row) => {
          if (row.kind === 'status') {
            const status = statusMap.get(row.entryId)
            if (!status) return null

            const actualStatus = getActualStatus(status)
            const replyTarget = getStatusReplyTargetId(actualStatus)
            const isReply = Boolean(replyTarget)
            const parentPreview = replyTarget
              ? timelineContext?.ancestorsById?.[replyTarget]
              : undefined

            return (
              <div
                key={row.key}
                className={cn(
                  'min-h-0 min-w-0',
                  framed && 'first:rounded-t-xl last:rounded-b-xl'
                )}
              >
                {renderPostItem(status, {
                  connectorPosition: 'single',
                  showReplyContext: isReply,
                  parentPreview
                })}
              </div>
            )
          }

          if (row.kind === 'thread') {
            const threadStatuses = row.entryIds
              .map((id) => statusMap.get(id))
              .filter((s): s is Status => Boolean(s))

            if (threadStatuses.length === 0) return null

            const isExpanded = expandedThreads.has(row.key)
            const shouldCollapse = threadStatuses.length > 3 && !isExpanded

            return (
              <div
                key={row.key}
                aria-label="Thread"
                className={cn(
                  'min-h-0 min-w-0 divide-y divide-border/40',
                  framed && 'first:rounded-t-xl last:rounded-b-xl'
                )}
              >
                {shouldCollapse ? (
                  <>
                    {/* First post */}
                    {renderPostItem(threadStatuses[0], {
                      connectorPosition: 'first',
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
                      <div className="relative flex shrink-0 flex-col items-center w-10">
                        <StatusConnectorRail position="middle" />
                        <div className="relative z-10 size-2.5 rounded-full bg-muted-foreground/40" />
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
                      connectorPosition: 'last',
                      showReplyContext: false
                    })}
                  </>
                ) : (
                  threadStatuses.map((status, index) => {
                    const total = threadStatuses.length
                    const connectorPosition =
                      total === 1
                        ? 'single'
                        : index === 0
                          ? 'first'
                          : index === total - 1
                            ? 'last'
                            : 'middle'

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
                      connectorPosition,
                      showReplyContext,
                      parentPreview
                    })
                  })
                )}
              </div>
            )
          }

          if (row.kind === 'conversation') {
            const convStatuses = row.entryIds
              .map((id) => statusMap.get(id))
              .filter((s): s is Status => Boolean(s))

            if (convStatuses.length === 0) return null

            return (
              <div
                key={row.key}
                aria-label="Conversation"
                className={cn(
                  'min-h-0 min-w-0 divide-y divide-border/40',
                  framed && 'first:rounded-t-xl last:rounded-b-xl'
                )}
              >
                {convStatuses.map((status, index) => {
                  const total = convStatuses.length
                  const connectorPosition =
                    total === 1
                      ? 'single'
                      : index === 0
                        ? 'first'
                        : index === total - 1
                          ? 'last'
                          : 'middle'

                  const isFirst = index === 0
                  const replyTarget = isFirst
                    ? getStatusReplyTargetId(getActualStatus(status))
                    : null
                  const showReplyContext =
                    Boolean(replyTarget) && !row.entryIds.includes(replyTarget!)
                  const parentPreview = replyTarget
                    ? timelineContext?.ancestorsById?.[replyTarget]
                    : undefined

                  return renderPostItem(status, {
                    connectorPosition,
                    showReplyContext,
                    parentPreview
                  })
                })}
              </div>
            )
          }

          if (row.kind === 'boosts') {
            const boostStatuses = row.entryIds
              .map((id) => statusMap.get(id))
              .filter((s): s is Status => Boolean(s))

            return (
              <BoostCarousel
                key={row.key}
                statuses={boostStatuses}
                currentActor={currentActor}
                onReply={onReply}
                onBoost={onBoost}
                onLike={onLike}
                onBookmark={onBookmark}
                onDelete={onDelete}
              />
            )
          }

          return null
        })}
      </section>
      <MediasModal
        medias={modalMedias?.medias ?? null}
        tags={modalMedias?.tags ?? null}
        initialSelection={modalMedias?.initialSelection ?? 0}
        onClosed={() => setModalMedias(null)}
      />
    </>
  )
}
