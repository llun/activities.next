import { Bookmark, SmilePlus } from 'lucide-react'
import { FC } from 'react'

import { PostProps } from '@/lib/components/posts/post'
import { ReactionState } from '@/lib/components/posts/useReactionState'
import {
  Status,
  StatusType,
  getOriginalStatus
} from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'

import { ActionRowErrors } from './actionButtonShared'
import { BookmarkButton } from './bookmark-button'
import { EditHistoryButton } from './edit-history-button'
import { LikeButton } from './like-button'
import { PostMenu, PostMenuExtraItem } from './post-menu'
import { ReactionButton, preloadReactionPicker } from './reaction-button'
import { ReplyButton } from './reply-button'
import { RepostButton } from './repost-button'
import { getBookmarkLabel, useBookmarkState } from './useBookmarkState'
import { useCompactActionBar } from './useCompactActionBar'

interface Props extends Omit<PostProps, 'currentTime'> {
  /** Required: a default of `Date.now()` would be frozen at mount by the compiler. */
  currentTime: number
  /** The post's reaction rollups, shared with the chip row above. */
  reactionState: ReactionState
  /**
   * Pull the row back over the avatar column (`size-10`) and its `gap-3` — 13
   * spacing steps, so it tracks the root font size the way those two do — and
   * add the gap that separates it from the post body. On by default, because
   * every surface that renders a post through `Post` has that avatar column.
   * Off for a surface that composes its own layout and already sits at the
   * status's left edge, such as the fitness activity detail's card footer.
   */
  fullBleed?: boolean
  /**
   * Extra ⋯ items for something only this surface knows about the post — the
   * fitness activity detail's "Change gear", so far. They render after the
   * items a compact row has displaced into the menu and before the menu's own,
   * so the displaced buttons stay nearest the row they came from.
   *
   * This can only ADD: there is no prop for removing or replacing one of the
   * menu's own items, because a post offers the same actions on every surface
   * (see **Status Posts & Actions** in AGENTS.md).
   */
  extraMenuItems?: PostMenuExtraItem[]
  /**
   * For a combined post, whose bar belongs to several posts: Reply acts on
   * (and counts the replies of) `replyStatus`, the latest post, while every
   * other control acts on `status`, the first. The labels then name the target
   * ("Reply to the latest post", "Like the first post") so the two are never
   * ambiguous to a screen reader. Without it every control acts on `status`.
   */
  splitTargets?: {
    replyStatus: Status
    replyLabel: string
    label: string
    /**
     * Names the ⋯ trigger when it holds the block's own items ("More actions
     * for this post group") rather than just the first post's.
     */
    menuLabel?: string
    /**
     * Headings for the ⋯ menu: one over the block's own items ("Show as
     * separate posts") and one over the items that act on `status` only, so
     * the menu says which post Quote, Edit, Copy link and Report reach.
     */
    menuHeadings?: { group: string; post: string }
  }
  onShowEdits?: (status: Status) => void
}

export const Actions: FC<Props> = ({
  host = '',
  currentActor,
  currentTime,
  status,
  editable = false,
  showActions = false,
  reactionState,
  fullBleed = true,
  extraMenuItems,
  splitTargets,
  onReply,
  onEdit,
  onQuote,
  onShowEdits,
  onPostDeleted,
  onBookmarkChanged,
  onLikeChanged
}) => {
  const actualStatus =
    status.type === StatusType.enum.Announce
      ? getOriginalStatus(status)
      : status
  // Owned here rather than by the button: on a narrow post the bookmark is a ⋯
  // menu item instead, and both spellings have to read the same state.
  const replyStatus = splitTargets
    ? getOriginalStatus(splitTargets.replyStatus)
    : actualStatus
  const targetLabel = splitTargets?.label
  const bookmark = useBookmarkState({
    status: actualStatus,
    onBookmarkChanged
  })
  const [barRef, isCompact] = useCompactActionBar()

  if (!showActions) return null
  if (!currentActor) return null

  const canEdit = editable && status.type !== StatusType.enum.Announce
  const isOwner =
    Boolean(actualStatus.isLocalActor) &&
    currentActor.id === actualStatus.actorId
  const hasEditHistory = actualStatus.edits.length > 0

  // Too narrow to seat every control at a comfortable hit size, so the two
  // least-used ones move into the menu that is already there. Both are
  // disabled while their own write is in flight: unlike the buttons they
  // replace, a menu item has no busy styling, so without this a tap during a
  // pending write would be swallowed by the state's single-flight guard with
  // nothing on screen to explain it.
  const compactItems: PostMenuExtraItem[] = isCompact
    ? [
        {
          key: 'react',
          icon: <SmilePlus className="size-4" />,
          label: targetLabel ? `React to ${targetLabel}` : 'React to post',
          disabled: reactionState.pendingName !== null,
          // The picker takes focus once it is placed, so it has to open after
          // the menu has finished handing focus back.
          deferUntilClosed: true,
          // Toggles, like the trigger, so selecting it again closes the
          // "Couldn't load" message a failed picker chunk leaves open.
          onSelect: () => reactionState.setIsPicking((value) => !value)
        },
        {
          key: 'bookmark',
          icon: (
            <Bookmark
              className={cn('size-4', bookmark.isBookmarked && 'fill-current')}
            />
          ),
          label: getBookmarkLabel(bookmark.isBookmarked, targetLabel),
          disabled: bookmark.isLoading,
          onSelect: () => {
            void bookmark.toggle()
          }
        }
      ]
    : []
  const extraItems = [...compactItems, ...(extraMenuItems ?? [])]

  return (
    <div
      ref={barRef}
      role="group"
      aria-label="Post actions"
      // `fullBleed` pulls the row back over the avatar column (`size-10`) and
      // its `gap-3` — 13 spacing steps, so it tracks the root font size the way
      // those two do — so the row starts at the post's own left edge. The row
      // still spans the whole width, but the actions stay packed together at
      // that left edge and only the ⋯ menu is pushed to the far right (see the
      // `ml-auto` on it below). `relative` so a control that has moved into the
      // menu can still anchor its error tooltip here without putting a flex
      // item back in the row.
      className={cn(
        'relative flex items-center gap-1 text-muted-foreground',
        fullBleed && '-ml-13 mt-3'
      )}
    >
      <ReplyButton
        status={replyStatus}
        targetLabel={splitTargets?.replyLabel}
        onReply={onReply}
      />
      <RepostButton
        currentActor={currentActor}
        status={actualStatus}
        targetLabel={targetLabel}
      />
      <LikeButton
        key={`${actualStatus.id}-like`}
        currentActor={currentActor}
        status={actualStatus}
        targetLabel={targetLabel}
        onLikeChanged={onLikeChanged}
      />
      {isCompact ? null : (
        <BookmarkButton state={bookmark} targetLabel={targetLabel} />
      )}
      {/* Still mounted when compact: the picker it renders is portalled, and
          the menu item that opens it needs somewhere for it to live. */}
      <ReactionButton
        state={reactionState}
        hideTrigger={isCompact}
        targetLabel={targetLabel}
      />
      {isCompact ? (
        // Those two buttons are gone from the row but their failures are not,
        // and each button was the only thing that rendered its own error. The
        // stack is absolutely positioned, so it adds no flex item and cannot
        // skew the spacing.
        <ActionRowErrors
          errors={[
            ...(bookmark.error
              ? [{ message: bookmark.error, testId: 'bookmark-error' }]
              : []),
            ...(reactionState.error
              ? [{ message: reactionState.error, testId: 'reaction-error' }]
              : [])
          ]}
        />
      ) : null}
      {hasEditHistory ? (
        <EditHistoryButton
          status={actualStatus}
          host={host}
          currentTime={currentTime}
          targetLabel={targetLabel}
          onShowEdits={onShowEdits}
        />
      ) : null}

      <PostMenu
        key={actualStatus.id}
        // The one action that is not part of the left-hand cluster: the auto
        // margin eats every pixel of free space in the row, which is what pins
        // ⋯ to the post's right edge while the rest stay packed on the left.
        className="ml-auto"
        targetLabel={splitTargets?.menuLabel ?? targetLabel}
        scopeLabels={splitTargets?.menuHeadings}
        status={actualStatus}
        isOwner={isOwner}
        canEdit={canEdit}
        triggerRef={isCompact ? reactionState.triggerRef : undefined}
        extraItems={extraItems}
        // The compact row's "React to post" item mounts the lazy picker.
        onMenuOpen={isCompact ? preloadReactionPicker : undefined}
        onReply={onReply}
        onEdit={onEdit}
        onQuote={onQuote}
        onPostDeleted={onPostDeleted}
      />
    </div>
  )
}
