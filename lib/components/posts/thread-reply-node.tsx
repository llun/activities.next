'use client'

import { AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { FC } from 'react'

import { InlineStatusComposer } from '@/lib/components/posts/lazy-inline-status-composer'
import { Post } from '@/lib/components/posts/post'
import {
  REPLYING_TO_LINK_CLASS_NAME,
  ThreadLineSegment,
  focusStatusAnchor,
  getReplyTargetName
} from '@/lib/components/posts/thread-line'
import type {
  ThreadConversation,
  ThreadDisplayRow,
  ThreadNode
} from '@/lib/components/posts/threadModel'
import type { InlineComposerControls } from '@/lib/components/posts/useInlineComposer'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import {
  Status,
  StatusNote,
  StatusPoll,
  getOriginalStatus
} from '@/lib/types/domain/status'

export interface ThreadReplySharedProps {
  host: string
  currentActor?: ActorProfile | null
  currentTime: number
  isMediaUploadEnabled?: boolean
  /** The surface's one inline composer; it opens under the row it targets. */
  composer: InlineComposerControls
  onOpenStatus: (status: Status) => void
  /** `actualStatus` is the reply itself, or the boosted post for a boost. */
  onShowAttachment: (
    allMedias: Attachment[],
    index: number,
    actualStatus: StatusNote | StatusPoll
  ) => void
  onReplyCreated?: (status: Status) => void
  /** After the composer posts (reply or quote) or saves an edit. */
  onComposerDone: () => void
  replyingToLabels?: ReadonlyMap<string, string>
  onPostDeleted?: (status: Status) => void
}

export interface ThreadReplyNodeProps extends ThreadReplySharedProps {
  node: ThreadNode
  /** The post this row answers; null for a reply to the opened post. */
  parent?: Status | null
  /** The row above is `parent`, joined to this one by the thread line. */
  lineAbove?: boolean
  /** The row below answers this one and joins it with the thread line. */
  lineBelow?: boolean
}

/**
 * One reply of a thread: its `Post` and the inline composer when it is open
 * on this reply. Rows are flat (see `buildThreadConversations`): a reply
 * joined to the row above by the thread line names its parent to screen
 * readers only; any other nested reply shows "Replying to <name>", a link to
 * that post. The post page's thread (`StatusThread`) and the fitness activity
 * page's replies block render their replies through this one component, so a
 * reply looks and behaves the same on both.
 */
export const ThreadReplyNode: FC<ThreadReplyNodeProps> = ({
  node,
  parent = null,
  lineAbove = false,
  lineBelow = false,
  host,
  currentActor,
  currentTime,
  isMediaUploadEnabled,
  composer,
  onOpenStatus,
  onShowAttachment,
  onReplyCreated,
  onComposerDone,
  replyingToLabels,
  onPostDeleted
}) => {
  // The reply itself, or the post a boost carries.
  const actualStatus = getOriginalStatus(node.status)
  const canCompose = Boolean(currentActor)
  const runReplyingToLabel = replyingToLabels?.get(node.status.id)
  const parentName = parent ? getReplyTargetName(parent) : ''
  const showReplyingToLink =
    Boolean(parent && parentName) && !lineAbove && !node.parentUnavailable

  return (
    <div
      id={node.status.id}
      data-testid="thread-node"
      data-node-id={node.status.id}
      data-depth={node.depth}
      tabIndex={-1}
      className="transition-colors focus:outline-none"
    >
      {node.parentUnavailable ? (
        <div
          data-testid="parent-unavailable-boundary"
          className="my-1.5 inline-flex items-center gap-1.5 rounded-md border border-dashed border-border/80 bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground"
        >
          <AlertCircle className="size-3.5" />
          <span>Prior reply is unavailable</span>
        </div>
      ) : null}

      <article className="relative pt-3">
        {lineAbove ? <ThreadLineSegment className="top-0 h-3" /> : null}
        {lineAbove && parentName ? (
          <span className="sr-only">Replying to {parentName}</span>
        ) : null}
        {showReplyingToLink && parent ? (
          <div className="mb-1 ml-13 text-xs text-muted-foreground">
            Replying to{' '}
            <a
              href={`#${parent.id}`}
              className={REPLYING_TO_LINK_CLASS_NAME}
              onClick={(event) => focusStatusAnchor(event, parent.id)}
            >
              {parentName}
            </a>
          </div>
        ) : runReplyingToLabel ? (
          <div className="mb-1 ml-13 text-xs text-muted-foreground">
            {runReplyingToLabel}
          </div>
        ) : null}
        <div data-testid={`status-${node.status.id}`}>
          <Post
            host={host}
            currentActor={currentActor ?? undefined}
            currentTime={currentTime}
            status={node.status}
            showActions={canCompose}
            showReadOnlyStats={!canCompose}
            editable={canCompose && currentActor?.id === actualStatus.actorId}
            collapsible
            fullBleed={!lineAbove && !lineBelow}
            threadLineBelow={lineBelow}
            onReply={
              canCompose
                ? (target) => composer.openReply(target, node.status.id)
                : undefined
            }
            onEdit={
              canCompose
                ? (target) => composer.openEdit(target, node.status.id)
                : undefined
            }
            onQuote={
              canCompose
                ? (target) => composer.openQuote(target, node.status.id)
                : undefined
            }
            onOpenStatus={onOpenStatus}
            onShowAttachment={(allMedias, index) =>
              onShowAttachment(allMedias, index, actualStatus)
            }
            onPostDeleted={onPostDeleted}
          />
        </div>

        {/* The row's bottom: the composer when open here, and the padding.
            The line runs on through both to the next row. */}
        <div className="relative pb-3">
          {lineBelow ? <ThreadLineSegment className="inset-y-0" /> : null}
          {composer.active?.anchorId === node.status.id && currentActor ? (
            // flow-root keeps the composer's own top margin inside this
            // block, so the line segment runs through it.
            <div className="flow-root">
              <InlineStatusComposer
                key={`${composer.active.mode}-${composer.active.anchorId}`}
                host={host}
                profile={currentActor}
                mode={composer.active.mode}
                status={composer.active.status}
                isMediaUploadEnabled={isMediaUploadEnabled}
                onCancel={composer.close}
                onReplyCreated={onReplyCreated}
                onCreated={() => {
                  composer.close()
                  onComposerDone()
                }}
                onUpdated={() => {
                  composer.close()
                  onComposerDone()
                }}
              />
            </div>
          ) : null}
        </div>
      </article>
    </div>
  )
}

type FoldRow = Extract<ThreadDisplayRow, { kind: 'fold' }>

export const getFoldLabels = (row: FoldRow) => {
  if (row.fold === 'conversation') {
    return {
      show: `Show ${row.hiddenCount} more in this conversation`,
      hide: `Hide ${row.hiddenCount} more in this conversation`
    }
  }
  const name = getReplyTargetName(row.parent)
  const noun = row.hiddenCount === 1 ? 'reply' : 'replies'
  const to = name ? ` to ${name}` : ''
  return {
    show: `Show ${row.hiddenCount} other ${noun}${to}`,
    hide: `Hide ${row.hiddenCount} other ${noun}${to}`
  }
}

interface ThreadFoldRowProps {
  row: FoldRow
  onToggle: (key: string) => void
}

/**
 * "Show N more in this conversation" (on the line, under the last shown post
 * of a chain) or "Show N other replies to <name>". The same button stays in
 * place and reads "Hide" once open, so focus stays on it.
 */
export const ThreadFoldRow: FC<ThreadFoldRowProps> = ({ row, onToggle }) => {
  const labels = getFoldLabels(row)
  const Icon = row.expanded ? ChevronUp : ChevronDown
  return (
    <div
      data-testid={`thread-fold-${row.key}`}
      // Unpadded, so the rail column spans the whole row and meets the
      // posts above and below; the button carries the row's spacing.
      className="flex min-w-0 gap-3"
    >
      <div className="relative w-10 shrink-0">
        {row.fold === 'conversation' ? (
          row.expanded ? (
            <ThreadLineSegment className="inset-y-0" />
          ) : (
            <span
              aria-hidden="true"
              className="absolute top-0 left-[19px] h-1/2 border-l-2 border-dotted border-border"
            />
          )
        ) : null}
      </div>
      <button
        type="button"
        data-testid={`thread-fold-toggle-${row.key}`}
        onClick={() => onToggle(row.key)}
        aria-expanded={row.expanded}
        aria-label={row.expanded ? labels.hide : undefined}
        className="my-1 inline-flex min-h-6 items-center gap-1 rounded-sm text-xs font-medium text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Icon aria-hidden="true" className="size-3.5 text-primary" />
        <span>{row.expanded ? 'Hide' : labels.show}</span>
      </button>
    </div>
  )
}

export interface ThreadConversationListProps extends ThreadReplySharedProps {
  conversations: readonly ThreadConversation[]
  onToggleFold: (key: string) => void
}

/**
 * Renders flattened conversations (see `buildThreadConversations`): one
 * element per top-level reply, so the caller's `divide-y` separates
 * conversations and never the rows inside one.
 */
export const ThreadConversationList: FC<ThreadConversationListProps> = ({
  conversations,
  onToggleFold,
  ...shared
}) => (
  <>
    {conversations.map((conversation) => (
      <div key={conversation.key} data-testid="thread-conversation">
        {conversation.rows.map((row) =>
          row.kind === 'fold' ? (
            <ThreadFoldRow key={row.key} row={row} onToggle={onToggleFold} />
          ) : (
            <ThreadReplyNode
              key={row.key}
              {...shared}
              node={row.node}
              parent={row.parent}
              lineAbove={row.lineAbove}
              lineBelow={row.lineBelow}
            />
          )
        )}
      </div>
    ))}
  </>
)
