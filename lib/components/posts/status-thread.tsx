'use client'

import { AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FC, ReactNode, useMemo, useState } from 'react'

import { MediasModal } from '@/lib/components/medias-modal/medias-modal'
import { InlineStatusComposer } from '@/lib/components/posts/inline-status-composer'
import { Post } from '@/lib/components/posts/post'
import { ReplyToast } from '@/lib/components/posts/reply-toast'
import {
  ThreadNode,
  buildThreadTree,
  getStatusReplyTargetId
} from '@/lib/components/posts/threadModel'
import { useInlineComposer } from '@/lib/components/posts/useInlineComposer'
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
  const composer = useInlineComposer()
  const [modalMedias, setModalMedias] = useState<{
    medias: Attachment[]
    tags?: Tag[]
    initialSelection: number
  } | null>(null)

  const [locallyCreatedReplies, setLocallyCreatedReplies] = useState<Status[]>(
    []
  )
  const [replyToastStatus, setReplyToastStatus] = useState<Status | null>(null)

  // Map of nodeId -> boolean override for expansion
  const [expandedBranchOverrides, setExpandedBranchOverrides] = useState<
    Record<string, boolean>
  >({})

  const allDescendants = useMemo(() => {
    if (locallyCreatedReplies.length === 0) return descendants
    const propIds = new Set(descendants.map((d) => d.id))
    const additions = locallyCreatedReplies.filter((d) => !propIds.has(d.id))
    if (additions.length === 0) return descendants
    return [...descendants, ...additions]
  }, [descendants, locallyCreatedReplies])

  const tree = useMemo(
    () =>
      buildThreadTree({
        focusedStatus: status,
        ancestors,
        descendants: allDescendants,
        hasMoreAncestors,
        hasMoreDescendants
      }),
    [status, ancestors, allDescendants, hasMoreAncestors, hasMoreDescendants]
  )

  const openStatus = (statusToOpen: Status) => {
    void (async () => {
      const detailPath = await getStatusDetailPathClient(statusToOpen)
      if (detailPath) router.push(detailPath)
    })()
  }

  const handleReplyCreated = (newReply: Status) => {
    setLocallyCreatedReplies((prev) => {
      if (
        prev.some((item) => item.id === newReply.id) ||
        descendants.some((item) => item.id === newReply.id)
      ) {
        return prev
      }
      return [...prev, newReply]
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
        const allKnown = [...descendants, ...locallyCreatedReplies, newReply]
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

    setTimeout(() => {
      const el = document.querySelector(
        `[data-node-id="${newReply.id}"], [data-testid="status-${newReply.id}"]`
      )
      if (typeof el?.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }, 100)

    onReplyCreated?.(newReply)
    router.refresh()
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
      const targetNode = findNode(tree.descendants)
      const initialState = targetNode ? !targetNode.initiallyCollapsed : true
      return { ...prev, [nodeId]: !initialState }
    })
  }

  const renderThreadNode = (node: ThreadNode): ReactNode => {
    const isExpanded = isBranchExpanded(node)
    const hasReplies = node.replies.length > 0
    const actualStatus =
      node.status.type === StatusType.enum.Announce
        ? getOriginalStatus(node.status)
        : node.status
    const canCompose = Boolean(currentActor)
    const boundedDepth = Math.min(node.depth, 4)

    return (
      <div
        key={node.status.id}
        data-testid="thread-node"
        data-node-id={node.status.id}
        data-depth={node.depth}
        className={cn(
          'transition-colors',
          boundedDepth > 0 &&
            'ml-3 sm:ml-5 pl-3 sm:pl-4 border-l-2 border-border/60'
        )}
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
              onOpenStatus={openStatus}
              onShowAttachment={(allMedias, index) => {
                setModalMedias({
                  medias: allMedias,
                  tags: actualStatus.tags,
                  initialSelection: index
                })
              }}
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

          {hasReplies ? (
            <div className="mt-1">
              <button
                type="button"
                data-testid={`toggle-replies-${node.status.id}`}
                onClick={() => toggleBranch(node.status.id)}
                aria-expanded={isExpanded}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline focus:outline-none"
              >
                {isExpanded ? (
                  <>
                    <ChevronUp className="size-3.5" />
                    <span>Hide replies</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="size-3.5" />
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
          <div className="space-y-1">
            {node.replies.map((reply) => renderThreadNode(reply))}
          </div>
        ) : null}
      </div>
    )
  }

  const actualFocusedStatus =
    status.type === StatusType.enum.Announce
      ? getOriginalStatus(status)
      : status
  const canComposeFocused = Boolean(currentActor)

  return (
    <div className={cn('space-y-0', className)}>
      {/* Load earlier ancestors control */}
      {hasMoreAncestors && onLoadMoreAncestors ? (
        <div className="border-b px-4 py-2 text-center">
          <button
            type="button"
            onClick={onLoadMoreAncestors}
            className="text-xs font-medium text-primary hover:underline"
          >
            Load earlier replies
          </button>
        </div>
      ) : null}

      {/* Ancestors in chronological order */}
      {tree.ancestors.length > 0 ? (
        <div data-testid="thread-ancestors">
          {tree.ancestors.map((ancestor, index) => {
            const actualAncestor =
              ancestor.type === StatusType.enum.Announce
                ? getOriginalStatus(ancestor)
                : ancestor
            return (
              <div
                key={ancestor.id}
                data-testid="ancestor-status"
                className={cn(
                  'border-b border-l-4 border-l-primary/30 bg-muted/30 p-4 last:border-b-0 max-md:rounded-none',
                  !currentActor && index === 0 && 'rounded-t-2xl'
                )}
              >
                <div data-testid={`status-${ancestor.id}`}>
                  <Post
                    host={host}
                    currentActor={currentActor ?? undefined}
                    currentTime={currentTime}
                    status={ancestor}
                    showActions={canComposeFocused}
                    showReadOnlyStats={!canComposeFocused}
                    connectorPosition={
                      index === 0
                        ? tree.ancestors.length > 1
                          ? 'first'
                          : 'middle'
                        : 'middle'
                    }
                    editable={
                      canComposeFocused &&
                      currentActor?.id === actualAncestor.actorId
                    }
                    collapsible
                    onReply={
                      canComposeFocused
                        ? (target) => composer.openReply(target, ancestor.id)
                        : undefined
                    }
                    onEdit={
                      canComposeFocused
                        ? (target) => composer.openEdit(target, ancestor.id)
                        : undefined
                    }
                    onQuote={
                      canComposeFocused
                        ? (target) => composer.openQuote(target, ancestor.id)
                        : undefined
                    }
                    onOpenStatus={openStatus}
                    onShowAttachment={(allMedias, idx) => {
                      setModalMedias({
                        medias: allMedias,
                        tags: actualAncestor.tags,
                        initialSelection: idx
                      })
                    }}
                  />
                </div>

                {composer.active?.anchorId === ancestor.id && currentActor ? (
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
              </div>
            )
          })}
        </div>
      ) : null}

      {/* Focused status */}
      <div
        data-testid="focused-status"
        className={cn(
          'border-b bg-background p-4 max-md:rounded-none',
          !currentActor && tree.ancestors.length === 0 && 'rounded-t-2xl'
        )}
      >
        <div data-testid={`status-${status.id}`}>
          <Post
            host={host}
            currentActor={currentActor ?? undefined}
            currentTime={currentTime}
            status={status}
            showActions={canComposeFocused}
            showReadOnlyStats={!canComposeFocused}
            editable={
              canComposeFocused &&
              currentActor?.id === actualFocusedStatus.actorId
            }
            connectorPosition={tree.ancestors.length > 0 ? 'last' : 'single'}
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
                initialSelection: index
              })
            }}
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
      </div>

      {/* Descendants tree */}
      {tree.totalDescendants > 0 ? (
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
                className="text-xs font-medium text-primary hover:underline"
              >
                Load more replies
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="p-8 text-center text-sm text-muted-foreground">
          No replies yet
        </div>
      )}

      <MediasModal
        medias={modalMedias?.medias ?? null}
        tags={modalMedias?.tags ?? null}
        initialSelection={modalMedias?.initialSelection ?? 0}
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
