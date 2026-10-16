'use client'

import { ChevronDown, MessageCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FC, useEffect, useId, useMemo, useState } from 'react'

import { InlineStatusComposer } from '@/lib/components/posts/inline-status-composer'
import { ThreadReplyNode } from '@/lib/components/posts/thread-reply-node'
import {
  type ThreadNode,
  buildThreadTree
} from '@/lib/components/posts/threadModel'
import type { InlineComposerControls } from '@/lib/components/posts/useInlineComposer'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import { Status } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'
import { getStatusDetailPathClient } from '@/lib/utils/getStatusDetailPathClient'

/**
 * Whether the reader last left the replies open or closed, for every activity
 * on this site: one key, not one per post, so the choice reads as a preference
 * ("I don't want to see replies here") rather than as per-post state.
 */
export const REPLIES_EXPANDED_STORAGE_KEY = 'activities.fitness.repliesExpanded'

/** Top-level replies shown at first, and how many more each "Load more" adds. */
export const REPLIES_PAGE_SIZE = 5

const readStoredExpanded = (): boolean | null => {
  try {
    const value = window.localStorage.getItem(REPLIES_EXPANDED_STORAGE_KEY)
    if (value === '1') return true
    if (value === '0') return false
  } catch {
    // Storage blocked (private window, disabled site data): open by default.
  }
  return null
}

const storeExpanded = (expanded: boolean) => {
  try {
    window.localStorage.setItem(
      REPLIES_EXPANDED_STORAGE_KEY,
      expanded ? '1' : '0'
    )
  } catch {
    // Not remembered this time; the toggle itself still works.
  }
}

export interface ActivityRepliesProps {
  host: string
  currentActor?: ActorProfile | null
  currentTime: number
  status: Status
  replies: Status[]
  isMediaUploadEnabled?: boolean
  /**
   * The activity's one inline composer. Reply on the post opens it anchored to
   * the post, and it renders here, at the top of the list it adds to.
   */
  composer: InlineComposerControls
  onShowAttachment: (allMedias: Attachment[], selectedIndex: number) => void
}

/**
 * The activity's replies, inside the post frame under its action row, the way
 * the post page lists them: a "Replies (N)" header that hides and shows the
 * list (remembered per site), the first few replies with "Load more replies"
 * for the rest, and "No replies yet" when there are none. Each reply is the
 * post page's own `ThreadReplyNode`, so nested replies, their toggles and
 * their inline composer behave the same here.
 */
export const ActivityReplies: FC<ActivityRepliesProps> = ({
  host,
  currentActor,
  currentTime,
  status,
  replies,
  isMediaUploadEnabled,
  composer,
  onShowAttachment
}) => {
  const router = useRouter()
  const listId = useId()
  const [isExpanded, setIsExpanded] = useState(true)
  const [visibleCount, setVisibleCount] = useState(REPLIES_PAGE_SIZE)
  const [locallyCreatedReplies, setLocallyCreatedReplies] = useState<Status[]>(
    []
  )
  const [expandedBranchOverrides, setExpandedBranchOverrides] = useState<
    Record<string, boolean>
  >({})

  // Read after mount: the server render has no storage, and reading it during
  // the first render would make the client's markup differ from the server's.
  useEffect(() => {
    const stored = readStoredExpanded()
    if (stored !== null) setIsExpanded(stored)
  }, [])

  const isReplyingToPost =
    Boolean(currentActor) &&
    composer.active?.anchorId === status.id &&
    composer.active.mode === 'reply'

  // Reply re-opens a list the reader had hidden: the reply lands in it.
  useEffect(() => {
    if (isReplyingToPost) setIsExpanded(true)
  }, [isReplyingToPost])

  const toggleExpanded = () => {
    // Worked out from this render's value, stored, then set: an updater has
    // to stay pure (React may call it twice), so the write is not inside it.
    const next = !isExpanded
    storeExpanded(next)
    setIsExpanded(next)
  }

  const allReplies = useMemo(() => {
    if (locallyCreatedReplies.length === 0) return replies
    const known = new Set(replies.map((reply) => reply.id))
    const additions = locallyCreatedReplies.filter(
      (reply) => !known.has(reply.id)
    )
    return additions.length > 0 ? [...additions, ...replies] : replies
  }, [replies, locallyCreatedReplies])

  const priorityStatusIds = useMemo(
    () => new Set(locallyCreatedReplies.map((reply) => reply.id)),
    [locallyCreatedReplies]
  )

  const tree = useMemo(
    () =>
      buildThreadTree({
        focusedStatus: status,
        descendants: allReplies,
        priorityStatusIds
      }),
    [status, allReplies, priorityStatusIds]
  )

  const isBranchExpanded = (node: ThreadNode): boolean =>
    expandedBranchOverrides[node.status.id] ?? !node.initiallyCollapsed

  const toggleBranch = (nodeId: string) => {
    const findNode = (nodes: ThreadNode[]): ThreadNode | null => {
      for (const node of nodes) {
        if (node.status.id === nodeId) return node
        const inChild = findNode(node.replies)
        if (inChild) return inChild
      }
      return null
    }
    setExpandedBranchOverrides((current) => {
      const target = findNode(tree.descendants)
      const isOpen =
        current[nodeId] ?? (target ? !target.initiallyCollapsed : true)
      return { ...current, [nodeId]: !isOpen }
    })
  }

  const handleReplyCreated = (reply: Status) => {
    setLocallyCreatedReplies((current) =>
      current.some((item) => item.id === reply.id) ||
      replies.some((item) => item.id === reply.id)
        ? current
        : [reply, ...current]
    )
  }

  const openStatus = (statusToOpen: Status) => {
    void (async () => {
      const detailPath = await getStatusDetailPathClient(statusToOpen)
      if (detailPath) router.push(detailPath)
    })()
  }

  const total = tree.totalDescendants
  const visibleNodes = tree.descendants.slice(0, visibleCount)
  const hiddenCount = tree.descendants.length - visibleNodes.length

  const replyComposer =
    isReplyingToPost && currentActor && composer.active ? (
      <div className="px-4 py-3">
        <InlineStatusComposer
          key={`${composer.active.mode}-${composer.active.anchorId}`}
          host={host}
          profile={currentActor}
          mode={composer.active.mode}
          status={composer.active.status}
          isMediaUploadEnabled={isMediaUploadEnabled}
          onCancel={composer.close}
          onReplyCreated={handleReplyCreated}
          onCreated={() => {
            composer.close()
            router.refresh()
          }}
          onUpdated={() => {
            composer.close()
            router.refresh()
          }}
        />
      </div>
    ) : null

  if (total === 0) {
    return (
      <div data-testid="activity-replies" className="border-t">
        {replyComposer ?? (
          <div className="p-4">
            <EmptyState icon={MessageCircle} title="No replies yet">
              {currentActor
                ? 'Be the first to reply.'
                : 'Replies show up here.'}
            </EmptyState>
          </div>
        )}
      </div>
    )
  }

  return (
    <div data-testid="activity-replies" className="border-t">
      <h2 className="sr-only">Replies</h2>
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-controls={listId}
        onClick={toggleExpanded}
        className={cn(
          'flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50',
          isExpanded && 'border-b'
        )}
      >
        <span>Replies ({total})</span>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
          {isExpanded ? 'Hide' : 'Show'}
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'size-3.5 transition-transform',
              isExpanded && 'rotate-180'
            )}
          />
        </span>
      </button>
      <div id={listId} hidden={!isExpanded}>
        {replyComposer ? <div className="border-b">{replyComposer}</div> : null}
        <div
          data-testid="activity-replies-list"
          className="divide-y divide-border/40 px-4 @max-[520px]:px-3"
        >
          {visibleNodes.map((node) => (
            <ThreadReplyNode
              key={node.status.id}
              node={node}
              host={host}
              currentActor={currentActor}
              currentTime={currentTime}
              isMediaUploadEnabled={isMediaUploadEnabled}
              composer={composer}
              isExpanded={isBranchExpanded}
              onToggle={toggleBranch}
              onOpenStatus={openStatus}
              onShowAttachment={(allMedias, index) =>
                onShowAttachment(allMedias, index)
              }
              onReplyCreated={handleReplyCreated}
              onComposerDone={() => router.refresh()}
            />
          ))}
        </div>
        {hiddenCount > 0 ? (
          <div className="border-t px-4 py-3 text-center">
            <button
              type="button"
              onClick={() =>
                setVisibleCount((count) => count + REPLIES_PAGE_SIZE)
              }
              className="rounded-sm text-xs font-medium text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Load more replies
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
