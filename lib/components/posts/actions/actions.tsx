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

import { BookmarkButton } from './bookmark-button'
import { EditHistoryButton } from './edit-history-button'
import { LikeButton } from './like-button'
import { PostMenu, PostMenuExtraItem } from './post-menu'
import { ReactionButton } from './reaction-button'
import { ReplyButton } from './reply-button'
import { RepostButton } from './repost-button'
import { useBookmarkState } from './useBookmarkState'
import { useCompactActionBar } from './useCompactActionBar'

interface Props extends PostProps {
  /** The post's reaction rollups, shared with the chip row above. */
  reactionState: ReactionState
  onShowEdits?: (status: Status) => void
}

export const Actions: FC<Props> = ({
  host,
  currentActor,
  currentTime,
  status,
  editable = false,
  showActions = false,
  reactionState,
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
  // least-used ones move into the menu that is already there.
  const extraItems: PostMenuExtraItem[] = isCompact
    ? [
        {
          key: 'react',
          icon: <SmilePlus className="size-4" />,
          label: 'React to post',
          // The picker autofocuses its search field, so it has to open after
          // the menu has finished handing focus back.
          deferUntilClosed: true,
          onSelect: () => reactionState.setIsPicking(true)
        },
        {
          key: 'bookmark',
          icon: (
            <Bookmark
              className={cn('size-4', bookmark.isBookmarked && 'fill-current')}
            />
          ),
          label: bookmark.label,
          onSelect: () => {
            void bookmark.toggle()
          }
        }
      ]
    : []

  return (
    <div
      ref={barRef}
      role="group"
      aria-label="Post actions"
      // Pulled 52px left — the avatar column (40px) plus its gap (12px) — so the
      // row starts at the post's own left edge, then spread across the whole
      // width with the ⋯ menu pinned to the far right.
      className="-ml-[52px] mt-3 flex items-center justify-between gap-1 text-muted-foreground"
    >
      <ReplyButton status={actualStatus} onReply={onReply} />
      <RepostButton currentActor={currentActor} status={actualStatus} />
      <LikeButton
        key={`${actualStatus.id}-like`}
        currentActor={currentActor}
        status={actualStatus}
        onLikeChanged={onLikeChanged}
      />
      {isCompact ? null : <BookmarkButton state={bookmark} />}
      {/* Still mounted when compact: the picker it renders is portalled, and
          the menu item that opens it needs somewhere for it to live. */}
      <ReactionButton state={reactionState} hideTrigger={isCompact} />
      {hasEditHistory ? (
        <EditHistoryButton
          status={actualStatus}
          host={host}
          currentTime={currentTime}
          onShowEdits={onShowEdits}
        />
      ) : null}

      <PostMenu
        key={actualStatus.id}
        status={actualStatus}
        isOwner={isOwner}
        canEdit={canEdit}
        triggerRef={isCompact ? reactionState.triggerRef : undefined}
        extraItems={extraItems}
        onReply={onReply}
        onEdit={onEdit}
        onQuote={onQuote}
        onPostDeleted={onPostDeleted}
      />
    </div>
  )
}
