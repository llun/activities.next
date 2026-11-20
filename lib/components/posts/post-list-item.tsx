'use client'

import { memo } from 'react'

import { PostLineLimit } from '@/lib/types/database/rows'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import { Status, StatusNote, StatusPoll } from '@/lib/types/domain/status'
import { TimelineParentPreview } from '@/lib/types/domain/timeline'
import { StatusReaction } from '@/lib/types/mastodon/statusReaction'
import { cn } from '@/lib/utils'
import { getActualStatus } from '@/lib/utils/text/processStatusText'

import { InlineStatusComposer } from './lazy-inline-status-composer'
import { Post } from './post'
import { ThreadLineSegment } from './thread-line'
import {
  ActiveStatusComposer,
  InlineComposerControls
} from './useInlineComposer'

export interface PostListItemProps {
  status: Status
  host: string
  currentTime: number
  currentActor?: ActorProfile
  showActions?: boolean
  showReadOnlyStats?: boolean
  postLineLimit?: PostLineLimit
  /** Extra classes for the `<article>` (e.g. the framed list's corner radius). */
  className?: string
  showReplyContext?: boolean
  isPinned?: boolean
  /** The row whose first picture is the list's first visible media. */
  prioritizeMedia?: boolean
  parentPreview?: TimelineParentPreview | null
  /**
   * The thread line from the row above (this post answers it) and on to the
   * row below (which answers this one), for a thread or conversation row
   * rendered post by post. Drawn inside the row, since a feed row clips.
   */
  threadLineAbove?: boolean
  threadLineBelow?: boolean
  /** Reply/quote/edit are offered (signed-in actor and an interactive feed). */
  canCompose: boolean
  /**
   * The composer anchored to this row, or null. Passing only this row's slice
   * (not the shared state) keeps every other row's props unchanged when the
   * composer opens, moves or closes.
   */
  activeComposer: ActiveStatusComposer | null
  isMediaUploadEnabled?: boolean
  // These four come straight from `useInlineComposer`, whose callbacks are
  // stable.
  openReply: InlineComposerControls['openReply']
  openQuote: InlineComposerControls['openQuote']
  openEdit: InlineComposerControls['openEdit']
  close: InlineComposerControls['close']
  onOpenStatus: (status: Status) => void
  onShowMedia: (
    medias: Attachment[],
    index: number,
    actualStatus: StatusNote | StatusPoll
  ) => void
  onStatusCreated?: (status: Status) => void
  onReplyCreated?: (status: Status) => void
  onPostUpdated?: (status: Status) => void
  onPostDeleted?: (status: Status) => void
  onBookmarkChanged?: (
    status: StatusNote | StatusPoll,
    isBookmarked: boolean,
    folderId?: string | null
  ) => void
  onLikeChanged?: (status: StatusNote | StatusPoll, isLiked: boolean) => void
  onReactionsChanged?: (
    status: StatusNote | StatusPoll,
    reactions: StatusReaction[]
  ) => void
}

/**
 * One post row plus, when it is the active row, the inline composer.
 *
 * Memoized on purpose: the React Compiler does not memoize per loop iteration,
 * so without `memo` every row of a list re-renders when the list's state (the
 * open composer, the media modal) changes. All props are plain values or stable
 * callbacks, so only the rows whose own props changed render.
 */
export const PostListItem = memo(function PostListItem({
  status,
  host,
  currentTime,
  currentActor,
  showActions,
  showReadOnlyStats,
  postLineLimit,
  className,
  showReplyContext,
  isPinned,
  prioritizeMedia,
  parentPreview,
  threadLineAbove = false,
  threadLineBelow = false,
  canCompose,
  activeComposer,
  isMediaUploadEnabled,
  openReply,
  openQuote,
  openEdit,
  close,
  onOpenStatus,
  onShowMedia,
  onStatusCreated,
  onReplyCreated,
  onPostUpdated,
  onPostDeleted,
  onBookmarkChanged,
  onLikeChanged,
  onReactionsChanged
}: PostListItemProps) {
  const actualStatus = getActualStatus(status)

  return (
    <article
      // `feed-row` (app/globals.css) skips rendering off-screen rows with
      // `content-visibility: auto`. Its containment applies to on-screen rows
      // too: the row becomes a stacking context and the containing block of
      // absolute and fixed descendants, and clips like `overflow: clip` to its
      // (rounded) padding box. So an overlay inside a row must be portaled, or
      // carry a bare `data-row-overlay` (never `={bool}`) on an element rendered
      // only while it is open (a row with one is not contained, see
      // globals.css). `ui/popover.tsx` accepts a `container`: passing one
      // inside a row defeats its portal.
      // Callers may pass the framed box's corner radius so any child
      // background can't bleed past the rounded edges now that the list has no
      // `overflow-hidden`.
      className={cn(
        'feed-row min-h-0 min-w-0 px-4 pt-3',
        (threadLineAbove || threadLineBelow) && 'relative',
        className
      )}
    >
      {threadLineAbove ? (
        <ThreadLineSegment edge="above" className="top-0 left-[35px] h-3" />
      ) : null}
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
        showReplyContext={showReplyContext}
        isPinned={isPinned}
        prioritizeMedia={prioritizeMedia}
        parentPreview={parentPreview}
        fullBleed={!threadLineAbove && !threadLineBelow}
        threadLineBelow={threadLineBelow}
        onReply={
          canCompose ? (target) => openReply(target, status.id) : undefined
        }
        onEdit={
          canCompose ? (target) => openEdit(target, status.id) : undefined
        }
        onQuote={
          canCompose ? (target) => openQuote(target, status.id) : undefined
        }
        onPostDeleted={onPostDeleted}
        onBookmarkChanged={onBookmarkChanged}
        onLikeChanged={onLikeChanged}
        onReactionsChanged={onReactionsChanged}
        onOpenStatus={onOpenStatus}
        onShowAttachment={(allMedias, index) =>
          onShowMedia(allMedias, index, actualStatus)
        }
      />
      {/* The row's bottom padding, after the composer when it is open here;
          the line runs on through both to the next row. */}
      {/* flow-root keeps the composer's own top margin inside this block. */}
      <div className={cn('flow-root pb-3', threadLineBelow && 'relative')}>
        {threadLineBelow ? <ThreadLineSegment className="inset-y-0" /> : null}
        {activeComposer && currentActor ? (
          <InlineStatusComposer
            key={`${activeComposer.mode}-${activeComposer.anchorId}`}
            host={host}
            profile={currentActor}
            mode={activeComposer.mode}
            status={activeComposer.status}
            isMediaUploadEnabled={isMediaUploadEnabled}
            onCancel={close}
            onReplyCreated={onReplyCreated}
            onCreated={onStatusCreated}
            onUpdated={onPostUpdated}
          />
        ) : null}
      </div>
    </article>
  )
})
