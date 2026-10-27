'use client'

import { formatDistance } from 'date-fns/formatDistance'
import {
  FC,
  ReactNode,
  RefObject,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import { ActorProfile } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import { Status, StatusNote, StatusPoll } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'
import { getActualStatus } from '@/lib/utils/text/processStatusText'

import { Actions } from './actions/actions'
import { PostMenuExtraItem } from './actions/post-menu'
import { getActorDisplayName } from './actor'
import {
  CombinedPartLabelButton,
  CombinedPartRailColumn,
  InsetReply,
  RAIL_LINE,
  createShowSeparateMenuItem
} from './combined-post-list-item'
import { CombinedPart } from './combinedThreadModel'
import { formatCompactRelativeTime } from './compactRelativeTime'
import { InlineStatusComposer } from './lazy-inline-status-composer'
import { PostBody, getPostTranslation } from './post-body'
import { PostHeader } from './post-header'
import { ReactionRow } from './reaction-row'
import { ReadOnlyStats } from './read-only-stats'
import {
  LONG_RUN_MAX_PARTS,
  collapseLongRun,
  formatLongRunCollapseLabel
} from './selfThreadModel'
import { TranslationProvider } from './translation-context'
import {
  ActiveStatusComposer,
  InlineComposerControls
} from './useInlineComposer'
import { useReactionState } from './useReactionState'

export interface SelfThreadRunProps {
  parts: readonly CombinedPart[]
  openedPartIndex?: number
  startAt?: number
  host: string
  currentTime: number
  currentActor?: ActorProfile
  showActions?: boolean
  showReadOnlyStats?: boolean
  canCompose: boolean
  activeComposer: ActiveStatusComposer | null
  isMediaUploadEnabled?: boolean
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
  onShowSeparate?: (statusIds: string[]) => void
  focusedFooter?: ReactNode
  onReplyCreated?: (status: Status) => void
  onStatusCreated?: (status: Status) => void
  onPostUpdated?: (status: Status) => void
  onPostDeleted?: (status: Status) => void
}

interface SelfThreadPartProps {
  part: CombinedPart
  partIndex: number
  totalParts: number
  isFirstHeader: boolean
  isLastRendered: boolean
  isOpened: boolean
  lastStatus: Status
  openedPartRef?: RefObject<HTMLDivElement | null>
  extraMenuItems?: PostMenuExtraItem[]
  focusedFooter?: ReactNode
  host: string
  currentTime: number
  currentActor?: ActorProfile
  showActions?: boolean
  showReadOnlyStats?: boolean
  canCompose: boolean
  activeComposer: ActiveStatusComposer | null
  isMediaUploadEnabled?: boolean
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
  onReplyCreated?: (status: Status) => void
  onStatusCreated?: (status: Status) => void
  onPostUpdated?: (status: Status) => void
  onPostDeleted?: (status: Status) => void
}

const SelfThreadPart: FC<SelfThreadPartProps> = ({
  part,
  partIndex,
  totalParts,
  isFirstHeader,
  isLastRendered,
  isOpened,
  lastStatus,
  openedPartRef,
  extraMenuItems,
  focusedFooter,
  host,
  currentTime,
  currentActor,
  showActions,
  showReadOnlyStats,
  canCompose,
  activeComposer,
  isMediaUploadEnabled,
  openReply,
  openQuote,
  openEdit,
  close,
  onOpenStatus,
  onShowMedia,
  onReplyCreated,
  onStatusCreated,
  onPostUpdated,
  onPostDeleted
}) => {
  const actualStatus = getActualStatus(part.status)
  const reactionState = useReactionState({
    currentActor: showActions ? currentActor : undefined,
    status: actualStatus
  })
  const { isTranslatable, translationLanguage } = getPostTranslation(
    actualStatus,
    Boolean(currentActor)
  )
  const label = `${partIndex + 1} of ${totalParts}`
  const compactTime = formatCompactRelativeTime(
    actualStatus.createdAt,
    currentTime
  )
  const spokenTime = formatDistance(actualStatus.createdAt, currentTime)
  const authorName = actualStatus.actor
    ? getActorDisplayName(actualStatus.actor) || actualStatus.actor.username
    : null

  const handleReply = canCompose
    ? (target: Status) => openReply(target, part.status.id)
    : undefined
  const handleEdit = canCompose
    ? (target: Parameters<typeof openEdit>[0]) =>
        openEdit(target, part.status.id)
    : undefined
  const handleQuote = canCompose
    ? (target: Status) => openQuote(target, part.status.id)
    : undefined

  const isComposingInPart = Boolean(
    activeComposer &&
    currentActor &&
    (activeComposer.anchorId === part.status.id ||
      part.insets.some((inset) => inset.id === activeComposer.anchorId))
  )

  return (
    <TranslationProvider
      key={actualStatus.id}
      statusId={actualStatus.id}
      language={translationLanguage}
      enabled={isTranslatable}
    >
      <div
        ref={isOpened ? openedPartRef : undefined}
        data-node-id={part.status.id}
        data-testid={`status-${part.status.id}`}
        aria-current={isOpened ? 'location' : undefined}
        tabIndex={-1}
        className={cn(
          'flex min-h-0 min-w-0 gap-3 focus:outline-none',
          isOpened &&
            '-mx-4 border-l-[3px] border-l-primary bg-primary/[0.07] py-1.5 pr-4 pl-[13px]',
          // The focused card pads its top by 16px: reach through it so the
          // tint on the first part meets the card edge, rounded as the card is.
          isOpened && isFirstHeader && '-mt-4 rounded-t-[inherit] pt-[22px]'
        )}
      >
        <CombinedPartRailColumn
          actualStatus={actualStatus}
          isFirst={isFirstHeader}
          isLast={isLastRendered}
          isOpened={isOpened}
        />

        <div
          className={cn('min-h-0 min-w-0 flex-1', !isLastRendered && 'pb-3')}
        >
          {isFirstHeader ? (
            <PostHeader
              status={part.status}
              currentTime={currentTime}
              onOpenStatus={isOpened ? undefined : onOpenStatus}
              lastStatus={lastStatus}
              focused={isOpened}
            />
          ) : (
            <div className="relative flex min-h-6 items-center justify-between gap-2 text-xs text-muted-foreground">
              {isOpened ? (
                <span>
                  {authorName
                    ? `${authorName} · ${label} · ${compactTime}`
                    : `${label} · ${compactTime}`}
                </span>
              ) : (
                <CombinedPartLabelButton
                  status={part.status}
                  label={label}
                  compactTime={compactTime}
                  spokenTime={spokenTime}
                  onOpenStatus={onOpenStatus}
                />
              )}
            </div>
          )}

          <PostBody
            host={host}
            currentTime={currentTime}
            status={part.status}
            currentActor={currentActor}
            onShowAttachment={(medias, mediaIndex) =>
              onShowMedia(medias, mediaIndex, actualStatus)
            }
            prioritizeMedia={isOpened}
          />

          <div className="mt-2">
            <ReactionRow state={reactionState} fullBleed={false} />
            <Actions
              host={host}
              currentActor={currentActor}
              currentTime={currentTime}
              status={part.status}
              editable={
                Boolean(currentActor) &&
                currentActor?.id === actualStatus.actorId
              }
              showActions={showActions}
              reactionState={reactionState}
              fullBleed={false}
              extraMenuItems={extraMenuItems}
              onReply={handleReply}
              onEdit={handleEdit}
              onQuote={handleQuote}
              onPostDeleted={onPostDeleted}
            />
            {showReadOnlyStats && !showActions ? (
              <ReadOnlyStats status={part.status} />
            ) : null}
          </div>

          {isOpened ? focusedFooter : null}

          {part.insets.map((inset) => (
            <div
              key={inset.id}
              data-node-id={inset.id}
              data-testid={`status-${inset.id}`}
            >
              <InsetReply
                status={inset}
                host={host}
                currentTime={currentTime}
                currentActor={currentActor}
                showActions={showActions}
                postLineLimit={0}
                onReply={
                  canCompose
                    ? (target) => openReply(target, inset.id)
                    : undefined
                }
                onEdit={
                  canCompose
                    ? (target) => openEdit(target, inset.id)
                    : undefined
                }
                onQuote={
                  canCompose
                    ? (target) => openQuote(target, inset.id)
                    : undefined
                }
                onPostDeleted={onPostDeleted}
                onOpenStatus={onOpenStatus}
                onShowMedia={onShowMedia}
              />
            </div>
          ))}

          {isComposingInPart && activeComposer && currentActor ? (
            <div className="mt-3">
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
            </div>
          ) : null}
        </div>
      </div>
    </TranslationProvider>
  )
}

export const SelfThreadRun: FC<SelfThreadRunProps> = ({
  parts,
  openedPartIndex = -1,
  startAt = 0,
  host,
  currentTime,
  currentActor,
  showActions,
  showReadOnlyStats,
  canCompose,
  activeComposer,
  isMediaUploadEnabled,
  openReply,
  openQuote,
  openEdit,
  close,
  onOpenStatus,
  onShowMedia,
  onShowSeparate,
  focusedFooter,
  onReplyCreated,
  onStatusCreated,
  onPostUpdated,
  onPostDeleted
}) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const openedPartRef = useRef<HTMLDivElement | null>(null)
  const runRef = useRef<HTMLDivElement | null>(null)
  const focusAfterExpandRef = useRef<string | null>(null)

  const longRun = useMemo(
    () => collapseLongRun(parts, openedPartIndex, LONG_RUN_MAX_PARTS),
    [parts, openedPartIndex]
  )
  const showCollapsedView = longRun.isCollapsed && !isExpanded

  const renderedIndices = useMemo(() => {
    if (!showCollapsedView) {
      return parts.map((_, index) => index).filter((index) => index >= startAt)
    }
    const indexSet = new Set<number>(
      longRun.visiblePartIndices.filter((index) => index >= startAt)
    )
    if (startAt < parts.length) {
      indexSet.add(startAt)
    }
    return [...indexSet].sort((a, b) => a - b)
  }, [showCollapsedView, longRun.visiblePartIndices, parts, startAt])

  // The button that revealed the parts unmounts with its row; hand focus to
  // the first part it revealed so keyboard users keep their place.
  useEffect(() => {
    const id = focusAfterExpandRef.current
    if (!isExpanded || !id) return
    focusAfterExpandRef.current = null
    runRef.current
      ?.querySelector<HTMLElement>(`[data-node-id="${id}"]`)
      ?.focus()
  }, [isExpanded])

  useEffect(() => {
    if (openedPartIndex <= 0) return
    const el = openedPartRef.current
    if (!el || typeof el.scrollIntoView !== 'function') return
    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      Boolean(window.matchMedia('(prefers-reduced-motion: reduce)')?.matches)
    el.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'nearest'
    })
  }, [openedPartIndex])

  if (renderedIndices.length === 0) return null

  const lastStatus = parts[parts.length - 1].status
  const separateItem: PostMenuExtraItem | null = onShowSeparate
    ? createShowSeparateMenuItem(() =>
        onShowSeparate(
          parts.flatMap((part) => [
            part.status.id,
            ...part.insets.map((inset) => inset.id)
          ])
        )
      )
    : null

  return (
    <div
      ref={runRef}
      data-testid="self-thread-run"
      data-combined-post
      className="rounded-t-[inherit]"
    >
      {renderedIndices.map((partIndex, renderPos) => {
        const part = parts[partIndex]
        const isFirstHeader = partIndex === 0
        const isLastRendered = renderPos === renderedIndices.length - 1
        const isOpened = partIndex === openedPartIndex
        const nextRenderedIndex = renderedIndices[renderPos + 1]
        const hiddenGapCount =
          showCollapsedView && nextRenderedIndex !== undefined
            ? nextRenderedIndex - partIndex - 1
            : 0

        return (
          <div
            key={part.status.id}
            className={isFirstHeader ? 'rounded-t-[inherit]' : undefined}
          >
            <SelfThreadPart
              part={part}
              partIndex={partIndex}
              totalParts={parts.length}
              isFirstHeader={isFirstHeader}
              isLastRendered={isLastRendered}
              isOpened={isOpened}
              lastStatus={lastStatus}
              openedPartRef={openedPartRef}
              extraMenuItems={
                isFirstHeader && separateItem ? [separateItem] : undefined
              }
              focusedFooter={focusedFooter}
              host={host}
              currentTime={currentTime}
              currentActor={currentActor}
              showActions={showActions}
              showReadOnlyStats={showReadOnlyStats}
              canCompose={canCompose}
              activeComposer={activeComposer}
              isMediaUploadEnabled={isMediaUploadEnabled}
              openReply={openReply}
              openQuote={openQuote}
              openEdit={openEdit}
              close={close}
              onOpenStatus={onOpenStatus}
              onShowMedia={onShowMedia}
              onReplyCreated={onReplyCreated}
              onStatusCreated={onStatusCreated}
              onPostUpdated={onPostUpdated}
              onPostDeleted={onPostDeleted}
            />

            {hiddenGapCount > 0 ? (
              <div
                data-testid="self-thread-collapse-row"
                className="flex min-w-0 gap-3"
              >
                <div className="relative w-10 shrink-0">
                  <span
                    aria-hidden="true"
                    className={cn(RAIL_LINE, 'inset-y-0')}
                  />
                </div>
                <div className="min-w-0 flex-1 pb-3">
                  <button
                    type="button"
                    onClick={() => {
                      focusAfterExpandRef.current =
                        parts[partIndex + 1].status.id
                      setIsExpanded(true)
                    }}
                    className="rounded-sm text-xs font-medium text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    {formatLongRunCollapseLabel(hiddenGapCount)}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
