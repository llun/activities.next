'use client'

import { formatDistance } from 'date-fns/formatDistance'
import { Rows3 } from 'lucide-react'
import { FC, memo } from 'react'

import { PostLineLimit } from '@/lib/types/database/rows'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import {
  EditableStatus,
  Status,
  StatusNote,
  StatusPoll,
  getOriginalStatus
} from '@/lib/types/domain/status'
import { TimelineParentPreview } from '@/lib/types/domain/timeline'
import { StatusReaction } from '@/lib/types/mastodon/statusReaction'
import { cn } from '@/lib/utils'
import { getActualStatus } from '@/lib/utils/text/processStatusText'

import { Actions } from './actions/actions'
import { EditHistoryButton } from './actions/edit-history-button'
import { LikeButton } from './actions/like-button'
import { PostMenu, PostMenuExtraItem } from './actions/post-menu'
import { ReplyButton } from './actions/reply-button'
import { ActorAvatar, getActorDisplayName } from './actor'
import { CombinedPart } from './combinedThreadModel'
import { formatCompactRelativeTime } from './compactRelativeTime'
import { InlineStatusComposer } from './lazy-inline-status-composer'
import { PostBody, getPostTranslation } from './post-body'
import { PostHeader } from './post-header'
import { ReactionRow } from './reaction-row'
import { ReadOnlyStats } from './read-only-stats'
import { StatusContextIndicator } from './status-context'
import { TranslationProvider } from './translation-context'
import {
  ActiveStatusComposer,
  InlineComposerControls
} from './useInlineComposer'
import { useReactionState } from './useReactionState'

export interface CombinedPostListItemProps {
  /** The run's author posts in order, each with the replies tucked under it. */
  parts: CombinedPart[]
  /**
   * Every status id of the timeline row this belongs to, handed back to
   * `onShowSeparate` so the choice survives the row's first post going away.
   */
  rowIds: string[]
  host: string
  currentTime: number
  currentActor?: ActorProfile
  showActions?: boolean
  showReadOnlyStats?: boolean
  postLineLimit?: PostLineLimit
  showReplyContext?: boolean
  parentPreview?: TimelineParentPreview | null
  /** Reply/quote/edit are offered (signed-in actor and an interactive feed). */
  canCompose: boolean
  /**
   * The composer anchored to this row (by the id of any of its posts), or null.
   * See `PostListItem`: passing only this row's slice keeps every other row's
   * props unchanged when the composer opens, moves or closes.
   */
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
  /** The ⋯ menu's "Show as separate posts": render this row post by post. */
  onShowSeparate: (rowIds: string[]) => void
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
}

// The rail runs down the 40px avatar column. 19px centres its 2px line in that
// column; the dot is 10px wide, so 15px centres it too. A label line is 24px
// tall, so its centre (and the dot's) is 12px down: the dot sits at 7px.
const RAIL_LINE = 'absolute left-[19px] w-0.5 bg-border'
const RAIL_DOT =
  'absolute left-[15px] top-[7px] size-2.5 rounded-full bg-muted-foreground/55'

const sameStatusList = (a: readonly Status[], b: readonly Status[]) =>
  a.length === b.length && a.every((status, index) => status === b[index])

const samePartList = (a: readonly CombinedPart[], b: readonly CombinedPart[]) =>
  a.length === b.length &&
  a.every(
    (part, index) =>
      part.status === b[index].status &&
      sameStatusList(part.insets, b[index].insets)
  )

// `parts` and `rowIds` are rebuilt whenever the feed's statuses change, so the
// default shallow comparison would re-render every combined row each time.
// Compare their contents instead; every other prop is a plain value or a
// stable callback, like `PostListItem`'s.
const arePropsEqual = (
  prev: CombinedPostListItemProps,
  next: CombinedPostListItemProps
) => {
  if (!samePartList(prev.parts, next.parts)) return false
  if (
    prev.rowIds.length !== next.rowIds.length ||
    !prev.rowIds.every((id, index) => id === next.rowIds[index])
  )
    return false
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]) as Set<
    keyof CombinedPostListItemProps
  >
  for (const key of keys) {
    if (key === 'parts' || key === 'rowIds') continue
    if (!Object.is(prev[key], next[key])) return false
  }
  return true
}

interface InsetReplyProps {
  status: Status
  host: string
  currentTime: number
  currentActor?: ActorProfile
  showActions?: boolean
  postLineLimit?: PostLineLimit
  onReply?: (status: Status) => void
  onEdit?: (status: EditableStatus) => void
  onQuote?: (status: Status) => void
  onPostDeleted?: (status: Status) => void
  onLikeChanged?: (status: StatusNote | StatusPoll, isLiked: boolean) => void
  onOpenStatus: (status: Status) => void
  onShowMedia: (
    medias: Attachment[],
    index: number,
    actualStatus: StatusNote | StatusPoll
  ) => void
}

/**
 * Someone else's reply to one of the run's posts, kept inside the combined
 * post as a small card under the post it answers. It has no media (the model
 * only tucks text in). Reply and like sit on the card; everything else a post
 * offers (quote, copy link, mute, block, report, translate, edit and delete
 * when it is the viewer's own, …) is in its own ⋯ menu.
 */
const InsetReply: FC<InsetReplyProps> = ({
  status,
  host,
  currentTime,
  currentActor,
  showActions,
  postLineLimit,
  onReply,
  onEdit,
  onQuote,
  onPostDeleted,
  onLikeChanged,
  onOpenStatus,
  onShowMedia
}) => {
  const actualStatus = getActualStatus(status)
  const isOwnPost =
    Boolean(actualStatus.isLocalActor) &&
    currentActor?.id === actualStatus.actorId
  const name = actualStatus.actor
    ? getActorDisplayName(actualStatus.actor) || actualStatus.actor.username
    : 'someone'
  const { isTranslatable, translationLanguage } = getPostTranslation(
    actualStatus,
    Boolean(currentActor)
  )

  return (
    <TranslationProvider
      key={actualStatus.id}
      statusId={actualStatus.id}
      language={translationLanguage}
      enabled={isTranslatable}
    >
      <div
        role="group"
        aria-label={`Reply by ${name}`}
        className="mt-2 flex min-w-0 gap-2 rounded-lg border bg-card p-2.5"
      >
        <div className="shrink-0">
          <ActorAvatar
            actor={actualStatus.actor}
            actorId={actualStatus.actorId}
            statusUrl={actualStatus.url}
            avatarClassName="size-7"
          />
        </div>
        <div className="min-w-0 flex-1">
          <PostHeader
            status={status}
            currentTime={currentTime}
            onOpenStatus={onOpenStatus}
          />
          <PostBody
            host={host}
            currentTime={currentTime}
            status={status}
            currentActor={currentActor}
            collapsible
            postLineLimit={postLineLimit}
            onOpenStatus={onOpenStatus}
            onShowAttachment={(medias, index) =>
              onShowMedia(medias, index, actualStatus)
            }
          />
          {showActions && currentActor ? (
            <div
              role="group"
              aria-label="Reply actions"
              className="relative -ml-2 mt-1 flex items-center gap-1 text-muted-foreground"
            >
              <ReplyButton
                status={actualStatus}
                targetLabel={`${name}'s reply`}
                onReply={onReply}
              />
              <LikeButton
                key={`${actualStatus.id}-like`}
                currentActor={currentActor}
                status={actualStatus}
                targetLabel={`${name}'s reply`}
                onLikeChanged={onLikeChanged}
              />
              <PostMenu
                className="ml-auto"
                triggerClassName="size-6"
                targetLabel={`${name}'s reply`}
                status={actualStatus}
                isOwner={isOwnPost}
                canEdit={isOwnPost}
                onReply={onReply}
                onEdit={onEdit}
                onQuote={onQuote}
                onPostDeleted={onPostDeleted}
              />
            </div>
          ) : null}
        </div>
      </div>
    </TranslationProvider>
  )
}

/**
 * A run of quick self-replies shown as one feed row: the first post's header
 * (with the span of time the run covers), every post's content stacked down a
 * thread rail, the replies others tucked in as small cards, and one action bar
 * at the bottom. The bar is split: Reply acts on the latest post, everything
 * else on the first.
 *
 * Like `PostListItem` it is memoized, and its overlays follow the same
 * `feed-row` rule (see the comment there): the menus and the reaction picker
 * are portalled and the error bubbles carry `data-row-overlay`.
 */
export const CombinedPostListItem = memo(function CombinedPostListItem({
  parts,
  rowIds,
  host,
  currentTime,
  currentActor,
  showActions,
  showReadOnlyStats,
  postLineLimit,
  showReplyContext,
  parentPreview,
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
  onStatusCreated,
  onReplyCreated,
  onPostUpdated,
  onPostDeleted,
  onBookmarkChanged,
  onLikeChanged,
  onReactionsChanged
}: CombinedPostListItemProps) {
  const firstStatus = parts[0].status
  const lastStatus = parts[parts.length - 1].status
  const firstActual = getActualStatus(firstStatus)
  const anchorId = firstStatus.id
  // Held here, for the first post: the chips and the bar's react button are two
  // halves of one control (see `Post`).
  const reactionState = useReactionState({
    currentActor: showActions ? currentActor : undefined,
    status: firstActual,
    onReactionsChanged
  })
  const showsActionRow = Boolean(showActions && currentActor)
  const { isTranslatable, translationLanguage } = getPostTranslation(
    firstActual,
    Boolean(currentActor)
  )
  const handleReply = canCompose
    ? (target: Status) => openReply(target, anchorId)
    : undefined
  const handleEdit = canCompose
    ? (target: Parameters<typeof openEdit>[0]) => openEdit(target, anchorId)
    : undefined
  const handleQuote = canCompose
    ? (target: Status) => openQuote(target, anchorId)
    : undefined
  const separateItem: PostMenuExtraItem = {
    key: 'show-separate',
    icon: <Rows3 className="size-4" />,
    label: 'Show as separate posts',
    // The combined article unmounts on select; wait for the menu to close so
    // focus is not restored to a trigger that is already gone.
    deferUntilClosed: true,
    group: true,
    onSelect: () => onShowSeparate(rowIds)
  }

  return (
    <article
      // See `PostListItem` for what `feed-row` contains.
      className="feed-row min-h-0 min-w-0 px-4 py-3"
      data-combined-post
    >
      <TranslationProvider
        key={firstActual.id}
        statusId={firstActual.id}
        language={translationLanguage}
        enabled={isTranslatable}
      >
        <div className="flex min-h-0 min-w-0 flex-col gap-1">
          {showReplyContext ? (
            <StatusContextIndicator
              parentPreview={parentPreview}
              isReply={Boolean(firstActual.reply)}
              host={host}
            />
          ) : null}
          <div>
            {parts.map((part, index) => {
              const isFirst = index === 0
              const isLast = index === parts.length - 1
              const actualStatus = getActualStatus(part.status)
              const label = `${index + 1} of ${parts.length}`
              const isOwnPost =
                Boolean(actualStatus.isLocalActor) &&
                currentActor?.id === actualStatus.actorId
              const compactTime = formatCompactRelativeTime(
                actualStatus.createdAt,
                currentTime
              )
              const spokenTime = formatDistance(
                actualStatus.createdAt,
                currentTime
              )
              const {
                isTranslatable: partTranslatable,
                translationLanguage: partLanguage
              } = getPostTranslation(actualStatus, Boolean(currentActor))

              const body = (
                <>
                  <PostBody
                    host={host}
                    currentTime={currentTime}
                    status={part.status}
                    currentActor={currentActor}
                    collapsible
                    postLineLimit={postLineLimit}
                    onOpenStatus={onOpenStatus}
                    onShowAttachment={(medias, mediaIndex) =>
                      onShowMedia(medias, mediaIndex, actualStatus)
                    }
                  />
                  {part.insets.map((inset) => (
                    <InsetReply
                      key={inset.id}
                      status={inset}
                      host={host}
                      currentTime={currentTime}
                      currentActor={currentActor}
                      showActions={showActions}
                      postLineLimit={postLineLimit}
                      onReply={handleReply}
                      onEdit={handleEdit}
                      onQuote={handleQuote}
                      onPostDeleted={onPostDeleted}
                      onLikeChanged={onLikeChanged}
                      onOpenStatus={onOpenStatus}
                      onShowMedia={onShowMedia}
                    />
                  ))}
                </>
              )

              return (
                <div key={part.status.id} className="flex min-w-0 gap-3">
                  <div className="relative w-10 shrink-0">
                    {isFirst ? (
                      <>
                        <ActorAvatar
                          actor={actualStatus.actor}
                          actorId={actualStatus.actorId}
                          statusUrl={actualStatus.url}
                        />
                        <span
                          aria-hidden="true"
                          className={cn(RAIL_LINE, 'top-[44px] bottom-0')}
                        />
                      </>
                    ) : (
                      <>
                        <span
                          aria-hidden="true"
                          className={cn(RAIL_LINE, 'top-0 h-[7px]')}
                        />
                        {isLast ? null : (
                          <span
                            aria-hidden="true"
                            className={cn(RAIL_LINE, 'top-[17px] bottom-0')}
                          />
                        )}
                        <span aria-hidden="true" className={RAIL_DOT} />
                      </>
                    )}
                  </div>
                  <div className={cn('min-w-0 flex-1', !isLast && 'pb-3')}>
                    {isFirst ? (
                      <>
                        <PostHeader
                          status={part.status}
                          currentTime={currentTime}
                          onOpenStatus={onOpenStatus}
                          lastStatus={lastStatus}
                        />
                        {body}
                      </>
                    ) : (
                      <TranslationProvider
                        key={actualStatus.id}
                        statusId={actualStatus.id}
                        language={partLanguage}
                        enabled={partTranslatable}
                      >
                        {/* `relative`: the edit history panel anchors to the
                            nearest positioned ancestor, which for the first
                            post is its action row; here it is this one. */}
                        <div className="relative flex min-h-6 items-center justify-between gap-2 text-xs text-muted-foreground">
                          <button
                            type="button"
                            className="-mx-1 rounded-sm px-1 py-0.5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                            aria-label={`Open part ${label}, posted ${spokenTime} ago`}
                            onClick={() => onOpenStatus(part.status)}
                          >
                            {label} · {compactTime}
                          </button>
                          <div className="flex items-center gap-1">
                            {showsActionRow && actualStatus.edits.length > 0 ? (
                              <EditHistoryButton
                                status={actualStatus}
                                host={host}
                                currentTime={currentTime}
                                targetLabel={`part ${label}`}
                              />
                            ) : null}
                            {showsActionRow ? (
                              <PostMenu
                                status={actualStatus}
                                isOwner={isOwnPost}
                                canEdit={isOwnPost}
                                triggerClassName="size-6"
                                targetLabel={`part ${label}`}
                                onReply={handleReply}
                                onEdit={handleEdit}
                                onQuote={handleQuote}
                                onPostDeleted={onPostDeleted}
                              />
                            ) : null}
                          </div>
                        </div>
                        {body}
                      </TranslationProvider>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {/* The bar belongs to the whole block, so it sits outside every
              part's translation scope and under the first post's. `ml-13` is
              what the bar's own `fullBleed` pulls back, so it starts at the
              row's left edge like a single post's. */}
          <div className="ml-13">
            <ReactionRow state={reactionState} fullBleed={showsActionRow} />
            <Actions
              host={host}
              currentActor={currentActor}
              currentTime={currentTime}
              status={firstStatus}
              editable={currentActor?.id === firstActual.actorId}
              showActions={showActions}
              reactionState={reactionState}
              extraMenuItems={[separateItem]}
              splitTargets={{
                replyStatus: getOriginalStatus(lastStatus),
                replyLabel: 'the latest post',
                label: 'the first post',
                menuLabel: 'this post group',
                menuHeadings: { group: 'Post group', post: 'First post' }
              }}
              onReply={handleReply}
              onEdit={handleEdit}
              onQuote={handleQuote}
              onPostDeleted={onPostDeleted}
              onBookmarkChanged={onBookmarkChanged}
              onLikeChanged={onLikeChanged}
            />
            {showReadOnlyStats && !showActions ? (
              <ReadOnlyStats status={firstStatus} />
            ) : null}
          </div>
        </div>
      </TranslationProvider>
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
    </article>
  )
}, arePropsEqual)
