'use client'

import { ChevronDown, MessageCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  FC,
  ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState
} from 'react'

import { InlineStatusComposer } from '@/lib/components/posts/lazy-inline-status-composer'
import { SelfThreadRun } from '@/lib/components/posts/self-thread-run'
import {
  SelfThreadRunBlock,
  buildSelfThreadModel,
  getRunMergedStatuses
} from '@/lib/components/posts/selfThreadModel'
import { ThreadLoadMore } from '@/lib/components/posts/thread-load-more'
import { ThreadReplyNode } from '@/lib/components/posts/thread-reply-node'
import {
  type ThreadNode,
  buildThreadTree
} from '@/lib/components/posts/threadModel'
import type { InlineComposerControls } from '@/lib/components/posts/useInlineComposer'
import { useOpenStatusPath } from '@/lib/components/posts/useOpenStatusPath'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import { Status, getOriginalStatus } from '@/lib/types/domain/status'
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
  /**
   * The conversation above the activity, root first. It renders above
   * `children` (the activity's own post) the way the post page renders a
   * post's ancestors, the athlete's own earlier parts as a run.
   */
  ancestors?: Status[]
  hasMoreAncestors?: boolean
  hasMoreDescendants?: boolean
  onLoadMoreAncestors?: () => void
  onLoadMoreDescendants?: () => void
  loadingMore?: 'ancestors' | 'descendants' | null
  loadMoreError?: 'ancestors' | 'descendants' | null
  isMediaUploadEnabled?: boolean
  /**
   * The activity's one inline composer. Reply on the post opens it anchored to
   * the post, and it renders here, at the top of the list it adds to.
   */
  composer: InlineComposerControls
  onShowAttachment: (allMedias: Attachment[], selectedIndex: number) => void
  /** The activity's own post, rendered between the ancestors and the replies. */
  children?: ReactNode
}

const EMPTY_STATUSES: Status[] = []

/**
 * The activity's conversation, inside the post frame: the posts above it (the
 * post page's ancestor rows, with "Load earlier posts"), the activity itself
 * (`children`), then its replies under the action row the way the post page
 * lists them: a "Replies (N)" header that hides and shows the list
 * (remembered per site), the first few replies with "Load more replies" for
 * the rest (and then for replies the page has not loaded), and "No replies
 * yet" when there are none and the activity stands on its own. Each reply is
 * the post page's own `ThreadReplyNode`, so nested replies, their toggles and
 * their inline composer behave the same here.
 */
export const ActivityReplies: FC<ActivityRepliesProps> = ({
  host,
  currentActor,
  currentTime,
  status,
  replies,
  ancestors = EMPTY_STATUSES,
  hasMoreAncestors = false,
  hasMoreDescendants = false,
  onLoadMoreAncestors,
  onLoadMoreDescendants,
  loadingMore = null,
  loadMoreError = null,
  isMediaUploadEnabled,
  composer,
  onShowAttachment,
  children
}) => {
  const router = useRouter()
  const openStatusPath = useOpenStatusPath()
  const listId = useId()
  const [isExpanded, setIsExpanded] = useState(true)
  const [visibleCount, setVisibleCount] = useState(REPLIES_PAGE_SIZE)
  const [locallyCreatedReplies, setLocallyCreatedReplies] = useState<Status[]>(
    []
  )
  const [deletedStatusIds, setDeletedStatusIds] = useState<Set<string>>(
    () => new Set()
  )
  const [expandedBranchOverrides, setExpandedBranchOverrides] = useState<
    Record<string, boolean>
  >({})

  const handlePostDeleted = useCallback((deletedStatus: Status) => {
    setDeletedStatusIds((prev) => {
      if (prev.has(deletedStatus.id)) return prev
      const next = new Set(prev)
      next.add(deletedStatus.id)
      return next
    })
  }, [])

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

  const visibleAncestors = useMemo(
    () =>
      deletedStatusIds.size === 0
        ? ancestors
        : ancestors.filter((ancestor) => !deletedStatusIds.has(ancestor.id)),
    [ancestors, deletedStatusIds]
  )

  const allReplies = useMemo(() => {
    const base =
      locallyCreatedReplies.length === 0
        ? replies
        : (() => {
            const known = new Set(replies.map((reply) => reply.id))
            const additions = locallyCreatedReplies.filter(
              (reply) => !known.has(reply.id)
            )
            return additions.length > 0 ? [...additions, ...replies] : replies
          })()
    return deletedStatusIds.size === 0
      ? base
      : base.filter((reply) => !deletedStatusIds.has(reply.id))
  }, [replies, locallyCreatedReplies, deletedStatusIds])

  const priorityStatusIds = useMemo(
    () => new Set(locallyCreatedReplies.map((reply) => reply.id)),
    [locallyCreatedReplies]
  )

  const selfThread = useMemo(
    () =>
      buildSelfThreadModel({
        focusedStatus: status,
        ancestors: visibleAncestors,
        descendants: allReplies,
        // The activity stays unchanged, so other people's replies to it stay
        // under Replies whatever part of the athlete's run it is.
        tuckIntoOpenedPart: false,
        hasMoreAncestors
      }),
    [status, visibleAncestors, allReplies, hasMoreAncestors]
  )
  const hasRun = Boolean(selfThread.run)
  const openedPartIndex = hasRun ? Math.max(0, selfThread.openedPartIndex) : 0
  // The athlete's earlier parts render as a run above the activity, the
  // follow-ups as a rail under its action row; both count every part.
  const hasEarlierParts = hasRun && openedPartIndex > 0
  const hasFollowUps = hasRun && selfThread.parts.length > openedPartIndex + 1
  const focusedGroupStatuses = useMemo(
    () => (hasRun ? selfThread.mergedStatuses : undefined),
    [hasRun, selfThread.mergedStatuses]
  )

  // As on the post page: with earlier ancestors not loaded, a run holding the
  // topmost loaded one may start above it, so its numbers are left out.
  const topLoadedAncestorId = hasMoreAncestors
    ? (visibleAncestors[0]?.id ?? null)
    : null
  const hidesPartNumbers = (statuses: readonly Status[]) =>
    topLoadedAncestorId !== null &&
    statuses.some((item) => item.id === topLoadedAncestorId)

  const ancestorRunByFirstStatusId = useMemo(() => {
    const map = new Map<string, SelfThreadRunBlock>()
    for (const run of selfThread.ancestorRuns) {
      map.set(run.parts[0].status.id, run)
    }
    return map
  }, [selfThread.ancestorRuns])
  const ancestorRows = useMemo(() => {
    const folded = new Set(
      selfThread.ancestorRuns.flatMap((run) =>
        getRunMergedStatuses(run)
          .filter((item) => item.id !== run.parts[0].status.id)
          .map((item) => item.id)
      )
    )
    return (hasRun ? selfThread.ancestorsOutsideRun : visibleAncestors).filter(
      (ancestor) => !folded.has(ancestor.id)
    )
  }, [
    hasRun,
    selfThread.ancestorRuns,
    selfThread.ancestorsOutsideRun,
    visibleAncestors
  ])

  const tree = useMemo(
    () =>
      buildThreadTree({
        focusedStatus: status,
        descendants: hasRun ? selfThread.repliesOutsideRun : allReplies,
        priorityStatusIds,
        focusedGroupStatuses
      }),
    [
      status,
      hasRun,
      selfThread.repliesOutsideRun,
      allReplies,
      priorityStatusIds,
      focusedGroupStatuses
    ]
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
      if (detailPath) openStatusPath(detailPath)
    })()
  }

  const total = tree.totalDescendants
  const visibleNodes = tree.descendants.slice(0, visibleCount)
  const hiddenCount = tree.descendants.length - visibleNodes.length

  const canCompose = Boolean(currentActor)
  const closeComposerAndRefresh = () => {
    composer.close()
    router.refresh()
  }
  const activeComposerIn = (statusIds: ReadonlySet<string>) =>
    canCompose && composer.active && statusIds.has(composer.active.anchorId)
      ? composer.active
      : null

  // A run of posts other than the activity's replies: an ancestor run, or the
  // athlete's earlier parts. A reply posted from one is not a reply to the
  // activity, so it is not added to the list here; the refresh brings the
  // page up to date.
  const renderRun = (
    parts: SelfThreadRunBlock['parts'],
    runIds: ReadonlySet<string>,
    options: {
      startAt?: number
      endBefore?: number
      anchorPartIndex?: number
      hidePartNumbers?: boolean
      onReplyCreated?: (reply: Status) => void
    }
  ) => (
    <SelfThreadRun
      parts={parts}
      startAt={options.startAt}
      endBefore={options.endBefore}
      anchorPartIndex={options.anchorPartIndex}
      hidePartNumbers={options.hidePartNumbers}
      host={host}
      currentTime={currentTime}
      currentActor={currentActor ?? undefined}
      showActions={canCompose}
      showReadOnlyStats={!canCompose}
      canCompose={canCompose}
      activeComposer={activeComposerIn(runIds)}
      isMediaUploadEnabled={isMediaUploadEnabled}
      openReply={composer.openReply}
      openQuote={composer.openQuote}
      openEdit={composer.openEdit}
      close={composer.close}
      onOpenStatus={openStatus}
      onShowMedia={(allMedias, index) => onShowAttachment(allMedias, index)}
      onReplyCreated={options.onReplyCreated}
      onStatusCreated={closeComposerAndRefresh}
      onPostUpdated={closeComposerAndRefresh}
      onPostDeleted={handlePostDeleted}
    />
  )

  // The activity's own run, minus the activity: the ids its composer may be
  // anchored to.
  const runPartIds = useMemo(
    () =>
      new Set(
        selfThread.mergedStatuses
          .map((item) => item.id)
          .filter((id) => id !== status.id)
      ),
    [selfThread.mergedStatuses, status.id]
  )

  const showAncestorsLoadMore = hasMoreAncestors && Boolean(onLoadMoreAncestors)
  const ancestorsBlock =
    showAncestorsLoadMore || ancestorRows.length > 0 || hasEarlierParts ? (
      <div data-testid="activity-ancestors">
        {showAncestorsLoadMore && onLoadMoreAncestors ? (
          <ThreadLoadMore
            label="Load earlier posts"
            onLoad={onLoadMoreAncestors}
            isLoading={loadingMore === 'ancestors'}
            hasError={loadMoreError === 'ancestors'}
            className="border-b py-2"
          />
        ) : null}
        {ancestorRows.map((ancestor) => {
          const ancestorRun = ancestorRunByFirstStatusId.get(ancestor.id)
          if (ancestorRun) {
            const merged = getRunMergedStatuses(ancestorRun)
            return (
              <div
                key={ancestor.id}
                data-testid="ancestor-status"
                className="border-b p-4"
              >
                {renderRun(
                  ancestorRun.parts,
                  new Set(merged.map((item) => item.id)),
                  {
                    anchorPartIndex: selfThread.ancestorRunAnchorIndexById.get(
                      ancestorRun.key
                    ),
                    hidePartNumbers: hidesPartNumbers(merged)
                  }
                )}
              </div>
            )
          }
          return (
            <div
              key={ancestor.id}
              id={ancestor.id}
              data-testid="ancestor-status"
              className="border-b px-4"
            >
              <ThreadReplyNode
                node={{
                  status: ancestor,
                  depth: 0,
                  replies: [],
                  totalDescendantCount: 0,
                  initiallyCollapsed: false
                }}
                host={host}
                currentActor={currentActor}
                currentTime={currentTime}
                isMediaUploadEnabled={isMediaUploadEnabled}
                composer={composer}
                isExpanded={() => true}
                onToggle={() => {}}
                onOpenStatus={openStatus}
                onShowAttachment={(allMedias, index) =>
                  onShowAttachment(allMedias, index)
                }
                onComposerDone={() => router.refresh()}
                onPostDeleted={handlePostDeleted}
              />
            </div>
          )
        })}
        {hasEarlierParts ? (
          <div data-testid="activity-earlier-parts" className="border-b p-4">
            {renderRun(selfThread.parts, runPartIds, {
              endBefore: openedPartIndex,
              hidePartNumbers: hidesPartNumbers(selfThread.mergedStatuses)
            })}
          </div>
        ) : null}
      </div>
    ) : null

  const followUpRail = hasFollowUps ? (
    <div data-testid="activity-follow-ups" className="border-t px-4 py-3">
      {renderRun(selfThread.parts, runPartIds, {
        startAt: openedPartIndex + 1,
        hidePartNumbers: hidesPartNumbers(selfThread.mergedStatuses),
        onReplyCreated: handleReplyCreated
      })}
    </div>
  ) : null

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

  // Replies the page has not loaded: "Load more replies" first shows the
  // loaded ones a page at a time, then asks for more.
  const canLoadMoreFromServer =
    hasMoreDescendants && Boolean(onLoadMoreDescendants)
  const loadMoreReplies = () => {
    if (hiddenCount === 0 && onLoadMoreDescendants) onLoadMoreDescendants()
    setVisibleCount((count) => count + REPLIES_PAGE_SIZE)
  }
  const loadMoreRow =
    hiddenCount > 0 || canLoadMoreFromServer ? (
      <ThreadLoadMore
        label="Load more replies"
        onLoad={loadMoreReplies}
        isLoading={hiddenCount === 0 && loadingMore === 'descendants'}
        hasError={hiddenCount === 0 && loadMoreError === 'descendants'}
        className="border-t"
      />
    ) : null

  // "No replies yet" only speaks for an activity on its own, as on the post
  // page: under a post of a conversation it reads as if the whole thread were
  // empty.
  const actualStatus = getOriginalStatus(status)
  const isInConversation =
    hasRun ||
    visibleAncestors.length > 0 ||
    hasMoreAncestors ||
    ('reply' in actualStatus && Boolean(actualStatus.reply))

  if (total === 0) {
    if (hasFollowUps || isInConversation || canLoadMoreFromServer) {
      const hasContent = Boolean(followUpRail || replyComposer || loadMoreRow)
      return (
        <>
          {ancestorsBlock}
          {children}
          {hasContent ? (
            <div data-testid="activity-replies">
              {followUpRail}
              {replyComposer ? (
                <div className="border-t">{replyComposer}</div>
              ) : null}
              {loadMoreRow}
            </div>
          ) : null}
        </>
      )
    }

    return (
      <>
        {ancestorsBlock}
        {children}
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
      </>
    )
  }

  return (
    <>
      {ancestorsBlock}
      {children}
      <div
        data-testid="activity-replies"
        className={cn(!hasFollowUps && 'border-t')}
      >
        {followUpRail}
        <div className={cn(hasFollowUps && 'border-t')}>
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
            {replyComposer ? (
              <div className="border-b">{replyComposer}</div>
            ) : null}
            <div
              data-testid="activity-replies-list"
              className="divide-y divide-border/40 px-4"
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
                  replyingToLabels={
                    hasRun ? selfThread.replyingToByReplyId : undefined
                  }
                  onPostDeleted={handlePostDeleted}
                />
              ))}
            </div>
            {loadMoreRow}
          </div>
        </div>
      </div>
    </>
  )
}
