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
import { OPENED_ROW_TINT } from '@/lib/components/posts/combined-post-list-item'
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
import {
  REPLYING_TO_LINK_CLASS_NAME,
  ThreadLineSegment,
  focusStatusAnchor,
  getReplyTargetName
} from '@/lib/components/posts/thread-line'
import { ThreadLoadMore } from '@/lib/components/posts/thread-load-more'
import { ThreadConversationList } from '@/lib/components/posts/thread-reply-node'
import {
  THREAD_FOLD_THRESHOLD,
  ThreadNode,
  buildThreadConversations,
  buildThreadTree,
  getFoldKeysRevealing,
  getStatusReplyTargetId,
  getStatusUrl,
  toggleFoldKey
} from '@/lib/components/posts/threadModel'
import { useInlineComposer } from '@/lib/components/posts/useInlineComposer'
import { useOpenStatusPath } from '@/lib/components/posts/useOpenStatusPath'
import { useScrollOpenedPostIntoView } from '@/lib/components/posts/useScrollOpenedPostIntoView'
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
  /** Which load is on its way, if any. */
  loadingMore?: 'ancestors' | 'descendants' | null
  /** Which load last failed, if any: its row shows an error with a Retry. */
  loadMoreError?: 'ancestors' | 'descendants' | null
  focusedFooter?: ReactNode
  renderFocusedFooter?: (status: Status) => ReactNode
  className?: string
  onReplyCreated?: (status: Status) => void
}

const EMPTY_STATUS_LIST: Status[] = []

interface ReplyingToLineProps {
  /** The author of the part being answered, or the handle of its actor id. */
  name: string
  /** The part's row on this page: run parts and plain ancestor rows share it. */
  statusId: string
  partIndex: number | null
  partCount: number | null
  /** Extra classes for the wrapping line, e.g. the full row's avatar offset. */
  className?: string
}

/**
 * The muted line naming the ancestor-run part the focused block answers,
 * rendered above the opened post's header or above the focused run's first
 * header. With reliable part numbers the "i of n" label links to the part;
 * without them (unloaded ancestors, or the run split into plain rows) the
 * name itself is the link.
 */
const ReplyingToLine: FC<ReplyingToLineProps> = ({
  name,
  statusId,
  partIndex,
  partCount,
  className
}) => (
  <div className={cn('mb-1 text-xs text-muted-foreground', className)}>
    {partIndex !== null && partCount !== null ? (
      <>
        Replying to {name} ·{' '}
        <a
          href={`#${statusId}`}
          className={REPLYING_TO_LINK_CLASS_NAME}
          onClick={(event) => focusStatusAnchor(event, statusId)}
          aria-label={`Part ${partIndex + 1} of ${partCount} by ${name}`}
        >
          {partIndex + 1} of {partCount}
        </a>
      </>
    ) : (
      <>
        Replying to{' '}
        <a
          href={`#${statusId}`}
          className={REPLYING_TO_LINK_CLASS_NAME}
          onClick={(event) => focusStatusAnchor(event, statusId)}
          aria-label={`Post by ${name}`}
        >
          {name}
        </a>
      </>
    )}
  </div>
)

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
  loadingMore = null,
  loadMoreError = null,
  focusedFooter,
  renderFocusedFooter,
  className,
  onReplyCreated
}) => {
  const router = useRouter()
  const openStatusPath = useOpenStatusPath()
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

  // Open folds by key (`getConversationFoldKey` / `getOthersFoldKey`), kept
  // by status id so loading more replies or posting one never closes them.
  const [expandedFolds, setExpandedFolds] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const toggleFold = useCallback((key: string) => {
    setExpandedFolds((prev) => toggleFoldKey(prev, key))
  }, [])
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
        descendants: allDescendants,
        hasMoreAncestors
      }),
    [status, visibleAncestors, allDescendants, hasMoreAncestors]
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

  // With earlier ancestors not loaded, a run holding the topmost loaded one
  // may start above the window, so its "i of n" labels could be wrong: they
  // are left out until "Load earlier posts" loads the rest.
  const topLoadedAncestorId = hasMoreAncestors
    ? (visibleAncestors[0]?.id ?? null)
    : null
  const hidesPartNumbers = (statuses: readonly Status[]) =>
    topLoadedAncestorId !== null &&
    statuses.some((item) => item.id === topLoadedAncestorId)

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

  // A reply to any status an ancestor run folds into one row — a later part
  // or a tucked inset — belongs under the run, not under the opened post.
  // The run's first part is the row that stays in the tree, so every other
  // merged id aliases to it and `buildThreadTree` routes those replies there.
  const ancestorRunReplyAliases = useMemo(() => {
    const aliases = new Map<string, string>()
    for (const run of activeAncestorRuns) {
      const firstPartId = run.parts[0].status.id
      for (const merged of getRunMergedStatuses(run)) {
        if (merged.id === firstPartId) continue
        for (const alias of [
          merged.id,
          getStatusUrl(merged),
          merged.publicId
        ]) {
          if (alias && alias !== firstPartId) aliases.set(alias, firstPartId)
        }
      }
    }
    return aliases
  }, [activeAncestorRuns])

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

  // Replies to the opened post's own run and to later runs read as direct
  // replies to the focused post; replies to ancestor-run parts route through
  // `ancestorRunReplyAliases` to the run's first row instead.
  const focusedGroupStatuses = useMemo(() => {
    const list: Status[] = [
      ...(isCombinedRun ? selfThread.mergedStatuses : []),
      ...descendantRunMergedStatuses
    ]
    return list.length > 0 ? list : undefined
  }, [isCombinedRun, selfThread.mergedStatuses, descendantRunMergedStatuses])

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
        focusedGroupStatuses,
        ancestorIdAliases: ancestorRunReplyAliases
      }),
    [
      status,
      treeAncestors,
      treeDescendants,
      hasMoreAncestors,
      hasMoreDescendants,
      priorityStatusIds,
      focusedGroupStatuses,
      ancestorRunReplyAliases
    ]
  )

  const openStatus = (statusToOpen: Status) => {
    void (async () => {
      const detailPath = await getStatusDetailPathClient(statusToOpen)
      if (detailPath) openStatusPath(detailPath)
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

    // Open every fold on the way to the new reply, so it shows where it
    // lands: its parent's other replies, or the chain it continues.
    const revealKeys = getFoldKeysRevealing(newReply, [
      ...ancestors,
      status,
      ...descendants,
      ...locallyCreatedReplies
    ])
    if (revealKeys.length > 0) {
      setExpandedFolds((prev) => new Set([...prev, ...revealKeys]))
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

  // Folding starts at the page's loaded reply count, the same for the
  // Replies section and the side replies under ancestors.
  const foldEnabled = tree.totalDescendants >= THREAD_FOLD_THRESHOLD

  const renderConversations = (nodes: readonly ThreadNode[]): ReactNode => (
    <ThreadConversationList
      conversations={buildThreadConversations(
        nodes,
        expandedFolds,
        foldEnabled
      )}
      onToggleFold={toggleFold}
      host={host}
      currentActor={currentActor}
      currentTime={currentTime}
      isMediaUploadEnabled={isMediaUploadEnabled}
      composer={composer}
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
    opened?: { openedPartIndex: number; focusedFooter: ReactNode },
    anchorPartIndex?: number,
    replyingTo?: ReactNode,
    hidePartNumbers?: boolean,
    continueRailBelow?: boolean
  ): ReactNode => {
    const closeComposerAndRefresh = () => {
      composer.close()
      router.refresh()
    }
    return (
      <SelfThreadRun
        parts={parts}
        openedPartIndex={opened?.openedPartIndex}
        anchorPartIndex={anchorPartIndex}
        hidePartNumbers={hidePartNumbers}
        continueRailBelow={continueRailBelow}
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
        replyingTo={replyingTo}
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
  // Only the replies that render in the Replies section count: the ones the
  // tree routes under an ancestor row (a reply to an ancestor-run part)
  // render up there instead, so the heading never counts replies it does
  // not list, and the section hides when nothing is left for it.
  const renderedReplyCount = tree.descendants.reduce(
    (sum, node) => sum + 1 + node.totalDescendantCount,
    0
  )
  const hasReplies = renderedReplyCount > 0
  // The ancestor-run part the focused block answers — the opened post itself,
  // or the run holding it. The model reports it whatever the authors and
  // whether the opened post renders as a plain row or inside its run; the
  // "i of n" numbers only stay while the run actually renders as a run: once
  // the viewer splits it into plain rows the part keeps its own anchor, and
  // the name alone links to it.
  const replyingToPart = selfThread.focusedReplyingTo
  // Empty when neither the actor nor its id yields a name: the line is then
  // skipped rather than naming nothing.
  const replyingToName = replyingToPart
    ? getReplyTargetName(replyingToPart.status)
    : ''
  const replyingToRunIsActive = replyingToPart
    ? activeAncestorRuns.some((run) =>
        run.parts.some((part) => part.status.id === replyingToPart.status.id)
      )
    : false
  const replyingToLineProps =
    replyingToPart && replyingToName
      ? {
          name: replyingToName,
          statusId: replyingToPart.status.id,
          partIndex: replyingToRunIsActive ? replyingToPart.partIndex : null,
          partCount: replyingToRunIsActive ? replyingToPart.partCount : null
        }
      : null
  const replyingToLine = replyingToLineProps ? (
    <ReplyingToLine {...replyingToLineProps} />
  ) : null
  // On the plain opened-row path the line names what the opened post itself
  // answers, not what its run's first part answers: once "Show as separate
  // posts" splits the opened post's own run, its later parts render as plain
  // rows whose reply target can differ from the run's, so the line only
  // stays when the opened post's own reply target is that part.
  const replyingToAliases = useMemo(
    () =>
      new Set(
        replyingToPart
          ? [
              replyingToPart.status.id,
              getStatusUrl(replyingToPart.status),
              replyingToPart.status.publicId
            ].filter((alias): alias is string => Boolean(alias))
          : []
      ),
    [replyingToPart]
  )
  const openedRowReplyTarget = getStatusReplyTargetId(actualFocusedStatus)
  const openedRowAnswersReplyingTo =
    openedRowReplyTarget !== null && replyingToAliases.has(openedRowReplyTarget)
  // The opened post carries the same marker as an opened run part, but only
  // when the page shows what it answers above it: a lone post with nothing
  // over it reads as itself, the way an own post only gets the tint as part
  // of a run.
  const openedRowIsMarked = tree.ancestors.length > 0
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
  // Also after a failed load or refresh, so its Retry stays reachable.
  const showDescendantsLoadMore =
    (hasMoreDescendants || loadMoreError === 'descendants') &&
    Boolean(onLoadMoreDescendants)
  const showEmptyReplies =
    !hasReplies &&
    !hasMoreDescendants &&
    !isInConversation &&
    !isComposingOnFocused
  // With neither replies nor the empty block below it, the focused post is the
  // thread's last row: it drops its bottom border and meets the frame's bottom
  // corners itself, since it paints a background. Logged out, the sign-in
  // block follows it inside the desktop frame, so only the mobile inset card
  // ends here.
  const focusedIsLast =
    !hasReplies &&
    !showEmptyReplies &&
    !showDescendantsLoadMore &&
    activeDescendantRuns.length === 0

  // The thread line joins a row above the opened post to the next one when
  // the next answers it (a run's last part, for a run row), as long as no side
  // replies render in between.
  const ancestorRowEdges = tree.ancestors.map((ancestor) => {
    const run = ancestorRunByFirstStatusId.get(ancestor.id)
    return {
      top: ancestor,
      bottom: run ? run.parts[run.parts.length - 1].status : ancestor
    }
  })
  const focusedTopStatus =
    isCombinedRun && selfThread.run ? selfThread.parts[0].status : status
  const rowAnswersAbove = (top: Status, aboveIndex: number): boolean => {
    const above = ancestorRowEdges[aboveIndex]
    if (!above) return false
    if (tree.ancestorReplies?.[tree.ancestors[aboveIndex].id]?.length) {
      return false
    }
    const target = getStatusReplyTargetId(getOriginalStatus(top))
    if (!target) return false
    const bottom = getOriginalStatus(above.bottom)
    return [bottom.id, bottom.url, above.bottom.publicId].includes(target)
  }
  const ancestorJoinsAbove = ancestorRowEdges.map((edge, index) =>
    rowAnswersAbove(edge.top, index - 1)
  )
  const focusedJoinsAbove = rowAnswersAbove(
    focusedTopStatus,
    ancestorRowEdges.length - 1
  )
  // A joined row names what it answers to screen readers, once: the visible
  // "Replying to" line does that when it is there.
  const aboveName = (aboveIndex: number) => {
    const above = ancestorRowEdges[aboveIndex]
    return above ? getReplyTargetName(above.bottom) : ''
  }
  const focusedAboveName = aboveName(ancestorRowEdges.length - 1)
  const ancestorJoinsBelow = (index: number) =>
    index === ancestorRowEdges.length - 1
      ? focusedJoinsAbove
      : ancestorJoinsAbove[index + 1]
  // Whether the opened block shows the visible "Replying to" line: the run
  // passes it to its first header; a plain opened row only when it answers
  // that part itself.
  const focusedShowsReplyingTo =
    isCombinedRun && selfThread.run
      ? Boolean(replyingToLine)
      : Boolean(replyingToLineProps && openedRowAnswersReplyingTo)
  // From the focused card's top edge to the opened avatar: its 16px padding,
  // the tint's 6px top padding (or the opened first part's own 22px), and the
  // "Replying to" line (20px) when it sits above the avatar.
  const focusedLineAboveClass =
    isCombinedRun && selfThread.run
      ? selfThread.openedPartIndex === 0
        ? 'h-[22px]'
        : 'h-4'
      : replyingToLineProps && openedRowAnswersReplyingTo
        ? openedRowIsMarked
          ? 'h-[42px]'
          : 'h-9'
        : openedRowIsMarked
          ? 'h-[22px]'
          : 'h-4'

  const focusedRef = useRef<HTMLDivElement | null>(null)
  useScrollOpenedPostIntoView(
    () => focusedRef.current,
    tree.ancestors.length > 0
  )

  return (
    <div className={cn('space-y-0', className)}>
      {/* Load earlier ancestors control */}
      {hasMoreAncestors && onLoadMoreAncestors ? (
        <ThreadLoadMore
          label="Load earlier posts"
          onLoad={onLoadMoreAncestors}
          isLoading={loadingMore === 'ancestors'}
          hasError={loadMoreError === 'ancestors'}
          className="border-b py-2"
        />
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
            const joinsAbove = ancestorJoinsAbove[index]
            const joinsBelow = ancestorJoinsBelow(index)
            return (
              <div
                key={ancestor.id}
                data-testid="ancestor-status"
                className={cn(
                  'relative border-b bg-background p-4 last:border-b-0',
                  joinsBelow && 'border-b-0',
                  // Signed-in viewers get the full-bleed feed surface below
                  // `md`, so every row is square there; a logged-out thread is
                  // an inset card at every width and its first row meets the
                  // card's top corners.
                  currentActor && 'max-md:rounded-none',
                  !currentActor && index === 0 && 'rounded-t-lg'
                )}
              >
                {joinsAbove ? (
                  <ThreadLineSegment className="top-0 left-[35px] h-4" />
                ) : null}
                {joinsAbove && aboveName(index - 1) ? (
                  <span className="sr-only">
                    Replying to {aboveName(index - 1)}
                  </span>
                ) : null}
                {joinsBelow ? (
                  <ThreadLineSegment className="bottom-0 left-[35px] h-4" />
                ) : null}
                {ancestorRun && ancestorRunIds ? (
                  renderSelfThreadRun(
                    ancestorRun.parts,
                    ancestorRunIds,
                    undefined,
                    selfThread.ancestorRunAnchorIndexById.get(ancestorRun.key),
                    undefined,
                    hidesPartNumbers(getRunMergedStatuses(ancestorRun)),
                    joinsBelow
                  )
                ) : (
                  <>
                    <div
                      id={ancestor.id}
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
                        fullBleed={!joinsAbove && !joinsBelow}
                        threadLineBelow={joinsBelow}
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

                    <div className="relative">
                      {joinsBelow ? (
                        <ThreadLineSegment className="inset-y-0" />
                      ) : null}
                      {composer.active?.anchorId === ancestor.id &&
                      currentActor ? (
                        <div className="flow-root">
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
                    </div>
                  </>
                )}

                {tree.ancestorReplies?.[ancestor.id]?.length ? (
                  <div className="mt-3 divide-y divide-border/40 border-t border-border/40">
                    {renderConversations(tree.ancestorReplies[ancestor.id])}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}

      {/* Focused status */}
      <div
        ref={focusedRef}
        data-testid="focused-status"
        className={cn(
          'relative border-b bg-background p-4',
          currentActor && 'max-md:rounded-none',
          !currentActor && tree.ancestors.length === 0 && 'rounded-t-lg',
          focusedIsLast &&
            (currentActor
              ? 'border-b-0 rounded-b-lg max-md:rounded-none'
              : 'max-md:border-b-0 max-md:rounded-b-lg')
        )}
      >
        {focusedJoinsAbove ? (
          <ThreadLineSegment
            className={cn('top-0 left-[35px]', focusedLineAboveClass)}
          />
        ) : null}
        {focusedJoinsAbove && !focusedShowsReplyingTo && focusedAboveName ? (
          <span className="sr-only">Replying to {focusedAboveName}</span>
        ) : null}
        {isCombinedRun && selfThread.run ? (
          renderSelfThreadRun(
            selfThread.parts,
            selfThread.mergedIds,
            {
              openedPartIndex: selfThread.openedPartIndex,
              focusedFooter:
                focusedFooter ??
                (renderFocusedFooter ? renderFocusedFooter(status) : null)
            },
            undefined,
            replyingToLine,
            hidesPartNumbers(selfThread.mergedStatuses)
          )
        ) : (
          <>
            <div
              data-testid={`status-${status.id}`}
              data-row-status-ids={status.id}
              tabIndex={-1}
              aria-current={openedRowIsMarked ? 'location' : undefined}
              className={cn(
                'focus:outline-none',
                // The opened post carries the same marker as an opened run
                // part, so the page reads the same as opening one's own post.
                openedRowIsMarked && OPENED_ROW_TINT
              )}
            >
              {replyingToLineProps && openedRowAnswersReplyingTo ? (
                <ReplyingToLine {...replyingToLineProps} className="ml-13" />
              ) : null}
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

      {/* Later self-thread blocks, each started by a visibility change */}
      {activeDescendantRuns.map((descendantRun, index) => {
        const descendantRunIds = new Set(
          getRunMergedStatuses(descendantRun).map((s) => s.id)
        )
        const isLastBlock =
          !hasReplies &&
          !showEmptyReplies &&
          !showDescendantsLoadMore &&
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
              Replies ({renderedReplyCount})
            </h2>
          </div>

          <div className="divide-y divide-border/40 p-4 space-y-2">
            {renderConversations(tree.descendants)}
          </div>

          {showDescendantsLoadMore && onLoadMoreDescendants ? (
            <ThreadLoadMore
              label="Load more replies"
              onLoad={onLoadMoreDescendants}
              isLoading={loadingMore === 'descendants'}
              hasError={loadMoreError === 'descendants'}
              className="border-t"
            />
          ) : null}
        </div>
      ) : showDescendantsLoadMore && onLoadMoreDescendants ? (
        // More replies exist but none loaded so far renders under Replies
        // (the loaded ones all belong to the author's run): the row stands
        // on its own under the thread.
        <ThreadLoadMore
          label="Load more replies"
          onLoad={onLoadMoreDescendants}
          isLoading={loadingMore === 'descendants'}
          hasError={loadMoreError === 'descendants'}
        />
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
