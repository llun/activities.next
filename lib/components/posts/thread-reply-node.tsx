'use client'

import { AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { FC } from 'react'

import { InlineStatusComposer } from '@/lib/components/posts/lazy-inline-status-composer'
import { Post } from '@/lib/components/posts/post'
import type { ThreadNode } from '@/lib/components/posts/threadModel'
import type { InlineComposerControls } from '@/lib/components/posts/useInlineComposer'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import {
  Status,
  StatusNote,
  StatusPoll,
  getOriginalStatus
} from '@/lib/types/domain/status'
import { StatusReaction } from '@/lib/types/mastodon/statusReaction'

export interface ThreadReplyNodeProps {
  node: ThreadNode
  host: string
  currentActor?: ActorProfile | null
  currentTime: number
  isMediaUploadEnabled?: boolean
  /** The surface's one inline composer; it opens under the row it targets. */
  composer: InlineComposerControls
  isExpanded: (node: ThreadNode) => boolean
  onToggle: (nodeId: string) => void
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
  onBookmarkChanged?: (
    status: StatusNote | StatusPoll,
    isBookmarked: boolean
  ) => void
  onLikeChanged?: (status: StatusNote | StatusPoll, isLiked: boolean) => void
  onReactionsChanged?: (
    status: StatusNote | StatusPoll,
    reactions: StatusReaction[]
  ) => void
}

/**
 * One reply of a thread and, when expanded, its own replies beneath it: the
 * reply's `Post`, the inline composer when it is open on this reply, and the
 * "Hide replies" / "Show N more replies" toggle. The post page's thread
 * (`StatusThread`) and the fitness activity page's replies block render their
 * replies through this one component, so a reply looks and behaves the same
 * on both.
 */
export const ThreadReplyNode: FC<ThreadReplyNodeProps> = (props) => {
  const {
    node,
    host,
    currentActor,
    currentTime,
    isMediaUploadEnabled,
    composer,
    isExpanded: getIsExpanded,
    onToggle,
    onOpenStatus,
    onShowAttachment,
    onReplyCreated,
    onComposerDone,
    replyingToLabels,
    onPostDeleted,
    onBookmarkChanged,
    onLikeChanged,
    onReactionsChanged
  } = props
  const isExpanded = getIsExpanded(node)
  const hasReplies = node.replies.length > 0
  // The reply itself, or the post a boost carries.
  const actualStatus = getOriginalStatus(node.status)
  const canCompose = Boolean(currentActor)
  const replyingToLabel = replyingToLabels?.get(node.status.id)

  return (
    <div
      data-testid="thread-node"
      data-node-id={node.status.id}
      data-depth={node.depth}
      className="transition-colors"
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

      <article className="py-3">
        {replyingToLabel ? (
          <div className="mb-1 ml-13 text-xs text-muted-foreground">
            {replyingToLabel}
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
            onBookmarkChanged={onBookmarkChanged}
            onLikeChanged={onLikeChanged}
            onReactionsChanged={onReactionsChanged}
          />
        </div>

        {composer.active?.anchorId === node.status.id && currentActor ? (
          <div className="mt-3">
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

        {hasReplies ? (
          <div className="mt-1">
            <button
              type="button"
              data-testid={`toggle-replies-${node.status.id}`}
              onClick={() => onToggle(node.status.id)}
              aria-expanded={isExpanded}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary-text hover:underline focus:outline-none"
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="size-3.5 text-primary" />
                  <span>Hide replies</span>
                </>
              ) : (
                <>
                  <ChevronDown className="size-3.5 text-primary" />
                  <span>
                    Show {node.totalDescendantCount} more{' '}
                    {node.totalDescendantCount === 1 ? 'reply' : 'replies'}
                  </span>
                </>
              )}
            </button>
          </div>
        ) : null}
      </article>

      {hasReplies && isExpanded ? (
        <div className="divide-y divide-border/40 border-t border-border/40">
          {node.replies.map((reply) => (
            <ThreadReplyNode key={reply.status.id} {...props} node={reply} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
