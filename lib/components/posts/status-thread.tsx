'use client'

import { MessageCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  FC,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import { getAlbumsOwnerId } from '@/lib/components/gallery/mediaAlbumsUi'
import { OwnPostMediasModal } from '@/lib/components/medias-modal/own-post-medias-modal'
import { CombinedPart } from '@/lib/components/posts/combinedThreadModel'
import { InlineStatusComposer } from '@/lib/components/posts/lazy-inline-status-composer'
import { Post } from '@/lib/components/posts/post'
import { ReplyToast } from '@/lib/components/posts/reply-toast'
import { SelfThreadRun } from '@/lib/components/posts/self-thread-run'
import {
  SelfThreadRunBlock,
  buildSelfThreadModel,
  getRunMergedStatuses
} from '@/lib/components/posts/selfThreadModel'
import { ThreadReplyNode } from '@/lib/components/posts/thread-reply-node'
import {
  ThreadNode,
  buildThreadTree,
  getStatusReplyTargetId
} from '@/lib/components/posts/threadModel'
import { useInlineComposer } from '@/lib/components/posts/useInlineComposer'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import {
  Status,
  StatusType,
  getOriginalStatus
} from '@/lib/types/domain/status'
import { Tag } from '@/lib/types/domain/tag'
import { cn } from '@/lib/utils'
import { getStatusDetailPathClient } from '@/lib/utils/getStatusDetailPathClient'

export interface StatusThreadProps {
  host: string
  status: Status
  ancestors?: Status[]
  descendants?: Status[]
  currentActor?: ActorProfile | null
  currentTime: number
  isMediaUploadEnabled?: boolean
  hasMoreAncestors?: boolean
  hasMoreDescendants?: boolean
  onLoadMoreAncestors?: () => void
  onLoadMoreDescendants?: () => void
  focusedFooter?: ReactNode
  renderFocusedFooter?: (status: Status) => ReactNode
  className?: string
  onReplyCreated?: (status: Status) => void
}

const EMPTY_STATUS_LIST: Status[] = []

export const StatusThread: FC<StatusThreadProps> = ({
  host,
  status,
  ancestors = EMPTY_STATUS_LIST,
  descendants = EMPTY_STATUS_LIST,
  currentActor,
  currentTime,
  isMediaUploadEnabled,
  hasMoreAncestors = false,
  hasMoreDescendants = false,
  onLoadMoreAncestors,
  onLoadMoreDescendants,
  focusedFooter,
  renderFocusedFooter,
  className,
  onReplyCreated
}) => {
  const router = useRouter()
  const composer = useInlineComposer(Boolean(currentActor))
  const [modalMedias, setModalMedias] = useState<{
    medias: Attachment[]
    tags?: Tag[]
    initialSelection: number
    /** The viewer's actor id when the post is their own (the albums pill). */
    albumsOwnerId: string | null
  } | null>(null)

  const [locallyCreatedReplies, setLocallyCreatedReplies] = useState<Status[]>(
    []
  )
  const [replyToastStatus, setReplyToastStatus] = useState<Status | null>(null)
  // The scroll to a just-posted reply is deferred a tick; clear it if the
  // thread unmounts first so it never touches a torn-down document.
  const replyScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
  useEffect(
    () => () => {
      if (replyScrollTimeoutRef.current) {
        clearTimeout(replyScrollTimeoutRef.current)
      }
    },
    []
  )

  // Map of nodeId -> boolean override for expansion
  const [expandedBranchOverrides, setExpandedBranchOverrides] = useState<
    Record<string, boolean>
  >({})
  const [separateRows, setSeparateRows] = useState<Set<string>>(() => new Set())
  const [deletedStatusIds, setDeletedStatusIds] = useState<Set<string>>(
    () => new Set()
  )
  const isRunSeparate = useCallback(
    (statusIds: string[]) => statusIds.some((id) => separateRows.has(id)),
    [separateRows]
  )
  const focusAfterSeparate = useRef<string | null>(null)
  const showRowSeparate = useCallback((entryIds: string[]) => {
    focusAfterSeparate.current = entryIds[0] ?? null
    setSeparateRows((prev) => {
      const next = new Set(prev)
      entryIds.forEach((id) => next.add(id))
      return next
    })
  }, [])
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
    const fallback = document.querySelector<HTMLElement>(
      `[data-testid="status-${id}"], [data-node-id="${id}"]`
    )
    fallback?.focus()
  }, [separateRows])

  const handlePostDeleted = useCallback((deletedStatus: Status) => {
    setDeletedStatusIds((prev) => {
      if (prev.has(deletedStatus.id)) return prev
      const next = new Set(prev)
      next.add(deletedStatus.id)
      return next
    })
  }, [])

  const visibleAncestors = useMemo(
    () =>
      deletedStatusIds.size === 0
        ? ancestors
        : ancestors.filter((a) => !deletedStatusIds.has(a.id)),
    [ancestors, deletedStatusIds]
  )

  const allDescendants = useMemo(() => {
    const base =
      locallyCreatedReplies.length === 0
        ? descendants
        : (() => {
            const propIds = new Set(descendants.map((d) => d.id))
            const additions = locallyCreatedReplies.filter(
              (d) => !propIds.has(d.id)
            )
            return additions.length === 0
              ? descendants
              : [...additions, ...descendants]
          })()
    return deletedStatusIds.size === 0
      ? base
      : base.filter((d) => !deletedStatusIds.has(d.id))
  }, [descendants, locallyCreatedReplies, deletedStatusIds])

  const priorityStatusIds = useMemo(
    () => new Set(locallyCreatedReplies.map((r) => r.id)),
    [locallyCreatedReplies]
  )

  const selfThread = useMemo(
    () =>
      buildSelfThreadModel({
        focusedStatus: status,
        ancestors: visibleAncestors,
        descendants: allDescendants
      }),
    [status, visibleAncestors, allDescendants]
  )

  const runStatusIds = useMemo(
    () => selfThread.mergedStatuses.map((s) => s.id),
    [selfThread.mergedStatuses]
  )

  const isCombinedRun = Boolean(selfThread.run && !isRunSeparate(runStatusIds))

  const activeAncestorRuns = useMemo(
    () =>
      selfThread.ancestorRuns.filter(
        (run) => !isRunSeparate(getRunMergedStatuses(run).map((s) => s.id))
      ),
    [selfThread.ancestorRuns, isRunSeparate]
  )

  const activeDescendantRuns = useMemo(
    () =>
      selfThread.descendantRuns.filter(
        (run) => !isRunSeparate(getRunMergedStatuses(run).map((s) => s.id))
      ),
    [selfThread.descendantRuns, isRunSeparate]
  )

  const ancestorRunByFirstStatusId = useMemo(() => {
    const map = new Map<string, SelfThreadRunBlock>()
    for (const run of activeAncestorRuns) {
      map.set(run.parts[0].status.id, run)
    }
    return map
  }, [activeAncestorRuns])

  // Everything an ancestor run folds into its first row (the row that stays in
  // the tree), so the tree skips these and treats them as part of the thread.
  const mergedSecondaryAncestorStatuses = useMemo(
    () =>
      activeAncestorRuns.flatMap((run) => [
        ...run.parts[0].insets,
        ...run.parts.slice(1).flatMap((part) => [part.status, ...part.insets])
      ]),
    [activeAncestorRuns]
  )

  const mergedSecondaryAncestorIds = useMemo(
    () => new Set(mergedSecondaryAncestorStatuses.map((s) => s.id)),
    [mergedSecondaryAncestorStatuses]
  )

  const descendantRunMergedStatuses = useMemo(
    () => activeDescendantRuns.flatMap(getRunMergedStatuses),
    [activeDescendantRuns]
  )

  const descendantRunMergedIds = useMemo(
    () => new Set(descendantRunMergedStatuses.map((s) => s.id)),
    [descendantRunMergedStatuses]
  )

  const treeAncestors = useMemo(() => {
    const base = isCombinedRun
      ? selfThread.ancestorsOutsideRun
      : visibleAncestors
    return mergedSecondaryAncestorIds.size === 0
      ? base
      : base.filter((a) => !mergedSecondaryAncestorIds.has(a.id))
  }, [
    isCombinedRun,
    selfThread.ancestorsOutsideRun,
    visibleAncestors,
    mergedSecondaryAncestorIds
  ])

  const treeDescendants = useMemo(() => {
    const base = isCombinedRun ? selfThread.repliesOutsideRun : allDescendants
    return base.filter(
      (d) =>
        !descendantRunMergedIds.has(d.id) &&
        !mergedSecondaryAncestorIds.has(d.id)
    )
  }, [
    isCombinedRun,
    selfThread.repliesOutsideRun,
    allDescendants,
    descendantRunMergedIds,
    mergedSecondaryAncestorIds
  ])

  const focusedGroupStatuses = useMemo(() => {
    const list: Status[] = [
      ...(isCombinedRun ? selfThread.mergedStatuses : []),
      ...mergedSecondaryAncestorStatuses,
      ...descendantRunMergedStatuses
    ]
    return list.length > 0 ? list : undefined
  }, [
    isCombinedRun,
    selfThread.mergedStatuses,
    mergedSecondaryAncestorStatuses,
    descendantRunMergedStatuses
  ])

  const hasAnyActiveRun =
    isCombinedRun ||
    activeAncestorRuns.length > 0 ||
    activeDescendantRuns.length > 0

  const tree = useMemo(
    () =>
      buildThreadTree({
        focusedStatus: status,
        ancestors: treeAncestors,
        descendants: treeDescendants,
        hasMoreAncestors,
        hasMoreDescendants,
        priorityStatusIds,
        focusedGroupStatuses
      }),
    [
      status,
      treeAncestors,
      treeDescendants,
      hasMoreAncestors,
      hasMoreDescendants,
      priorityStatusIds,
      focusedGroupStatuses
    ]
  )

  const openStatus = (statusToOpen: Status) => {
    void (async () => {
      const detailPath = await getStatusDetailPathClient(statusToOpen)
      if (detailPath) router.push(detailPath)
    })()
  }

  const handleReplyCreated = (newReply: Status) => {
    if (
      typeof document !== 'undefined' &&
      document.activeElement instanceof HTMLElement
    ) {
      document.activeElement.blur()
    }

    setLocallyCreatedReplies((prev) => {
      if (
        prev.some((item) => item.id === newReply.id) ||
        descendants.some((item) => item.id === newReply.id)
      ) {
        return prev
      }
      return [newReply, ...prev]
    })

    const actualReply = getOriginalStatus(newReply)
    const parentId =
      ('reply' in actualReply &&
      typeof actualReply.reply === 'string' &&
      actualReply.reply.trim()
        ? actualReply.reply.trim()
        : null) || getStatusReplyTargetId(actualReply)

    if (parentId) {
      setExpandedBranchOverrides((prev) => {
        const next = { ...prev, [parentId]: true }
        let curId: string | null = parentId
        const seen = new Set<string>()
        const allKnown = [
          ...ancestors,
          status,
          ...descendants,
          ...locallyCreatedReplies,
          newReply
        ]
        while (curId && !seen.has(curId)) {
          seen.add(curId)
          next[curId] = true
          const parentStatus = allKnown.find(
            (d) => d.id === curId || getOriginalStatus(d).url === curId
          )
          if (parentStatus) {
            curId = getStatusReplyTargetId(getOriginalStatus(parentStatus))
          } else {
            break
          }
        }
        return next
      })
    }

    setReplyToastStatus(newReply)

    if (replyScrollTimeoutRef.current) {
      clearTimeout(replyScrollTimeoutRef.current)
    }
    replyScrollTimeoutRef.current = setTimeout(() => {
      replyScrollTimeoutRef.current = null
      const el = document.querySelector(
        `[data-node-id="${newReply.id}"], [data-testid="status-${newReply.id}"]`
      )
      if (typeof el?.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }, 50)

    onReplyCreated?.(newReply)
    // Note: router.refresh() is omitted to avoid Next.js App Router resetting scroll to top.
  }

  const isBranchExpanded = (node: ThreadNode): boolean => {
    const nodeStatus = getOriginalStatus(node.status)
    const override =
      expandedBranchOverrides[node.status.id] ??
      (nodeStatus.url ? expandedBranchOverrides[nodeStatus.url] : undefined)
    if (override !== undefined) return override
    return !node.initiallyCollapsed
  }

  const toggleBranch = (nodeId: string) => {
    setExpandedBranchOverrides((prev) => {
      const current = prev[nodeId]
      if (current !== undefined) {
        return { ...prev, [nodeId]: !current }
      }
      // If no override yet, check tree initial state
      const findNode = (nodes: ThreadNode[]): ThreadNode | null => {
        for (const n of nodes) {
          if (
            n.status.id === nodeId ||
            getOriginalStatus(n.status).url === nodeId
          )
            return n
          const inChild = findNode(n.replies)
          if (inChild) return inChild
        }
        return null
      }
      const allTreeNodes = [
        ...tree.descendants,
        ...Object.values(tree.ancestorReplies ?? {}).flat()
      ]
      const targetNode = findNode(allTreeNodes)
      const initialState = targetNode ? !targetNode.initiallyCollapsed : true
      return { ...prev, [nodeId]: !initialState }
    })
  }

  const renderThreadNode = (node: ThreadNode): ReactNode => (
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
      onShowAttachment={(allMedias, index, actualStatus) => {
        setModalMedias({
          medias: allMedias,
          tags: actualStatus.tags,
          initialSelection: index,
          albumsOwnerId: getAlbumsOwnerId(currentActor, actualStatus)
        })
      }}
      onReplyCreated={handleReplyCreated}
      onComposerDone={() => router.refresh()}
      replyingToLabels={
        hasAnyActiveRun ? selfThread.replyingToByReplyId : undefined
      }
      onPostDeleted={handlePostDeleted}
    />
  )

  const canComposeFocused = Boolean(currentActor)

  const renderSelfThreadRun = (
    parts: readonly CombinedPart[],
    runStatusIds: ReadonlySet<string>,
    opened?: { openedPartIndex: number; focusedFooter: ReactNode }
  ): ReactNode => {
    const closeComposerAndRefresh = () => {
      composer.close()
      router.refresh()
    }
    return (
      <SelfThreadRun
        parts={parts}
        openedPartIndex={opened?.openedPartIndex}
        host={host}
        currentTime={currentTime}
        currentActor={currentActor ?? undefined}
        showActions={canComposeFocused}
        showReadOnlyStats={!canComposeFocused}
        canCompose={canComposeFocused}
        activeComposer={
          composer.active && runStatusIds.has(composer.active.anchorId)
            ? composer.active
            : null
        }
        isMediaUploadEnabled={isMediaUploadEnabled}
        openReply={composer.openReply}
        openQuote={composer.openQuote}
        openEdit={composer.openEdit}
        close={composer.close}
        onOpenStatus={openStatus}
        onShowMedia={(allMedias, index, actualStatus) => {
          setModalMedias({
            medias: allMedias,
            tags: actualStatus.tags,
            initialSelection: index,
            albumsOwnerId: getAlbumsOwnerId(currentActor, actualStatus)
          })
        }}
        onShowSeparate={showRowSeparate}
        focusedFooter={opened?.focusedFooter}
        onReplyCreated={handleReplyCreated}
        onStatusCreated={closeComposerAndRefresh}
        onPostUpdated={closeComposerAndRefresh}
        onPostDeleted={handlePostDeleted}
      />
    )
  }

  const actualFocusedStatus =
    status.type === StatusType.enum.Announce
      ? getOriginalStatus(status)
      : status
  const hasReplies = tree.totalDescendants > 0
  // "No replies yet" only speaks for a post on its own. Under the last post of
  // a conversation it reads as if the whole thread were empty, so there the
  // page ends after the post, as on Mastodon. An open composer on the focused
  // post takes the block's place, and cancelling it brings the block back.
  const isInConversation =
    hasAnyActiveRun ||
    tree.ancestors.length > 0 ||
    hasMoreAncestors ||
    Boolean(actualFocusedStatus.reply)
  const isComposingOnFocused =
    Boolean(currentActor) &&
    (composer.active?.anchorId === status.id ||
      (isCombinedRun &&
        selfThread.mergedIds.has(composer.active?.anchorId ?? '')) ||
      descendantRunMergedIds.has(composer.active?.anchorId ?? ''))
  const showEmptyReplies =
    !hasReplies && !isInConversation && !isComposingOnFocused
  // With neither replies nor the empty block below it, the focused post is the
  // thread's last row: it drops its bottom border and meets the frame's bottom
  // corners itself, since it paints a background. Logged out, the sign-in
  // block follows it inside the desktop frame, so only the mobile inset card
  // ends here.
  const focusedIsLast =
    !hasReplies && !showEmptyReplies && activeDescendantRuns.length === 0

  return (
    <div className={cn('space-y-0', className)}>
      {/* Load earlier ancestors control */}
      {hasMoreAncestors && onLoadMoreAncestors ? (
        <div className="border-b px-4 py-2 text-center">
          <button
            type="button"
            onClick={onLoadMoreAncestors}
            className="text-xs font-medium text-primary-text hover:underline"
          >
            Load earlier replies
          </button>
        </div>
      ) : null}

      {/* Ancestors in chronological order */}
      {tree.ancestors.length > 0 ? (
        <div data-testid="thread-ancestors">
          {tree.ancestors.map((ancestor, index) => {
            const ancestorRun = ancestorRunByFirstStatusId.get(ancestor.id)
            const actualAncestor =
              ancestor.type === StatusType.enum.Announce
                ? getOriginalStatus(ancestor)
                : ancestor
            const ancestorRunIds = ancestorRun
              ? new Set(getRunMergedStatuses(ancestorRun).map((s) => s.id))
              : null
            return (
              <div
                key={ancestor.id}
                data-testid="ancestor-status"
                className={cn(
                  'border-b bg-background p-4 last:border-b-0',
                  // Signed-in viewers get the full-bleed feed surface below
                  // `md`, so every row is square there; a logged-out thread is
                  // an inset card at every width and its first row meets the
                  // card's top corners.
                  currentActor && 'max-md:rounded-none',
                  !currentActor && index === 0 && 'rounded-t-lg'
                )}
              >
                {ancestorRun && ancestorRunIds ? (
                  renderSelfThreadRun(ancestorRun.parts, ancestorRunIds)
                ) : (
                  <>
                    <div
                      data-testid={`status-${ancestor.id}`}
                      data-row-status-ids={ancestor.id}
                      tabIndex={-1}
                      className="focus:outline-none"
                    >
                      <Post
                        host={host}
                        currentActor={currentActor ?? undefined}
                        currentTime={currentTime}
                        status={ancestor}
                        showActions={canComposeFocused}
                        showReadOnlyStats={!canComposeFocused}
                        editable={
                          canComposeFocused &&
                          currentActor?.id === actualAncestor.actorId
                        }
                        collapsible
                        onReply={
                          canComposeFocused
                            ? (target) =>
                                composer.openReply(target, ancestor.id)
                            : undefined
                        }
                        onEdit={
                          canComposeFocused
                            ? (target) => composer.openEdit(target, ancestor.id)
                            : undefined
                        }
                        onQuote={
                          canComposeFocused
                            ? (target) =>
                                composer.openQuote(target, ancestor.id)
                            : undefined
                        }
                        onOpenStatus={openStatus}
                        onShowAttachment={(allMedias, idx) => {
                          setModalMedias({
                            medias: allMedias,
                            tags: actualAncestor.tags,
                            initialSelection: idx,
                            albumsOwnerId: getAlbumsOwnerId(
                              currentActor,
                              actualAncestor
                            )
                          })
                        }}
                        onPostDeleted={handlePostDeleted}
                      />
                    </div>

                    {composer.active?.anchorId === ancestor.id &&
                    currentActor ? (
                      <div className="mt-3">
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
                    ) : null}
                  </>
                )}

                {tree.ancestorReplies?.[ancestor.id]?.length ? (
                  <div className="mt-3 divide-y divide-border/40 border-t border-border/40">
                    {tree.ancestorReplies[ancestor.id].map((replyNode) =>
                      renderThreadNode(replyNode)
                    )}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}

      {/* Focused status */}
      <div
        data-testid="focused-status"
        className={cn(
          'border-b bg-background p-4',
          currentActor && 'max-md:rounded-none',
          !currentActor && tree.ancestors.length === 0 && 'rounded-t-lg',
          focusedIsLast &&
            (currentActor
              ? 'border-b-0 rounded-b-lg max-md:rounded-none'
              : 'max-md:border-b-0 max-md:rounded-b-lg')
        )}
      >
        {isCombinedRun && selfThread.run ? (
          renderSelfThreadRun(selfThread.parts, selfThread.mergedIds, {
            openedPartIndex: selfThread.openedPartIndex,
            focusedFooter:
              focusedFooter ??
              (renderFocusedFooter ? renderFocusedFooter(status) : null)
          })
        ) : (
          <>
            <div
              data-testid={`status-${status.id}`}
              data-row-status-ids={status.id}
              tabIndex={-1}
              className="focus:outline-none"
            >
              <Post
                host={host}
                currentActor={currentActor ?? undefined}
                currentTime={currentTime}
                status={status}
                focused
                showActions={canComposeFocused}
                showReadOnlyStats={!canComposeFocused}
                editable={
                  canComposeFocused &&
                  currentActor?.id === actualFocusedStatus.actorId
                }
                onReply={
                  canComposeFocused
                    ? (target) => composer.openReply(target, status.id)
                    : undefined
                }
                onEdit={
                  canComposeFocused
                    ? (target) => composer.openEdit(target, status.id)
                    : undefined
                }
                onQuote={
                  canComposeFocused
                    ? (target) => composer.openQuote(target, status.id)
                    : undefined
                }
                onShowAttachment={(allMedias, index) => {
                  setModalMedias({
                    medias: allMedias,
                    tags: actualFocusedStatus.tags,
                    initialSelection: index,
                    albumsOwnerId: getAlbumsOwnerId(
                      currentActor,
                      actualFocusedStatus
                    )
                  })
                }}
                onPostDeleted={handlePostDeleted}
              />
            </div>

            {focusedFooter ??
              (renderFocusedFooter ? renderFocusedFooter(status) : null)}

            {composer.active?.anchorId === status.id && currentActor ? (
              <div className="mt-3">
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
            ) : null}
          </>
        )}
      </div>

      {/* Later self-thread blocks separated by > 10 min */}
      {activeDescendantRuns.map((descendantRun, index) => {
        const descendantRunIds = new Set(
          getRunMergedStatuses(descendantRun).map((s) => s.id)
        )
        const isLastBlock =
          !hasReplies &&
          !showEmptyReplies &&
          index === activeDescendantRuns.length - 1
        return (
          <div
            key={descendantRun.key}
            data-testid="self-thread-continuation-block"
            className={cn(
              'border-b bg-background p-4',
              currentActor && 'max-md:rounded-none',
              isLastBlock &&
                (currentActor
                  ? 'border-b-0 rounded-b-lg max-md:rounded-none'
                  : 'max-md:border-b-0 max-md:rounded-b-lg')
            )}
          >
            {renderSelfThreadRun(descendantRun.parts, descendantRunIds)}
          </div>
        )
      })}

      {/* Descendants tree */}
      {hasReplies ? (
        <div data-testid="thread-descendants">
          <div className="border-b px-5 py-3">
            <h2 className="font-semibold text-sm">
              Replies ({tree.totalDescendants})
            </h2>
          </div>

          <div className="divide-y divide-border/40 p-4 space-y-2">
            {tree.descendants.map((node) => renderThreadNode(node))}
          </div>

          {hasMoreDescendants && onLoadMoreDescendants ? (
            <div className="border-t px-4 py-3 text-center">
              <button
                type="button"
                onClick={onLoadMoreDescendants}
                className="text-xs font-medium text-primary-text hover:underline"
              >
                Load more replies
              </button>
            </div>
          ) : null}
        </div>
      ) : showEmptyReplies ? (
        <div className="p-4">
          <EmptyState icon={MessageCircle} title="No replies yet">
            {currentActor ? 'Be the first to reply.' : 'Replies show up here.'}
          </EmptyState>
        </div>
      ) : null}

      <OwnPostMediasModal
        medias={modalMedias?.medias ?? null}
        tags={modalMedias?.tags ?? null}
        initialSelection={modalMedias?.initialSelection ?? 0}
        albumsOwnerId={modalMedias?.albumsOwnerId}
        onClosed={() => setModalMedias(null)}
      />

      {replyToastStatus ? (
        <ReplyToast
          status={replyToastStatus}
          onDismiss={() => setReplyToastStatus(null)}
          onViewReply={(statusToView) => {
            openStatus(statusToView)
          }}
        />
      ) : null}
    </div>
  )
}
