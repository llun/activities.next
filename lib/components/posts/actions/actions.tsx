import { FC } from 'react'

import { PostProps } from '@/lib/components/posts/post'
import { ReactionState } from '@/lib/components/posts/useReactionState'
import {
  Status,
  StatusType,
  getOriginalStatus
} from '@/lib/types/domain/status'

import { BookmarkButton } from './bookmark-button'
import { EditHistoryButton } from './edit-history-button'
import { LikeButton } from './like-button'
import { PostMenu } from './post-menu'
import { ReactionButton } from './reaction-button'
import { ReplyButton } from './reply-button'
import { RepostButton } from './repost-button'
import { useBookmarkState } from './useBookmarkState'

interface Props extends PostProps {
  /**
   * The post's reaction rollups, shared with the chip row above. Absent only on
   * surfaces that render no chips at all.
   */
  reactionState?: ReactionState
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
  // Owned here rather than by the button, so the row is the single place that
  // knows whether this status is bookmarked.
  const bookmark = useBookmarkState({
    status: actualStatus,
    onBookmarkChanged
  })

  if (!showActions) return null
  if (!currentActor) return null

  const canEdit = editable && status.type !== StatusType.enum.Announce
  const isOwner =
    Boolean(actualStatus.isLocalActor) &&
    currentActor.id === actualStatus.actorId
  const hasEditHistory = actualStatus.edits.length > 0

  return (
    <div
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
      <BookmarkButton state={bookmark} />
      {reactionState ? <ReactionButton state={reactionState} /> : null}
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
        onReply={onReply}
        onEdit={onEdit}
        onQuote={onQuote}
        onPostDeleted={onPostDeleted}
      />
    </div>
  )
}
