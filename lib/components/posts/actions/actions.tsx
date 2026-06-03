import { FC, ReactNode } from 'react'

import { PostProps } from '@/lib/components/posts/post'
import {
  Status,
  StatusType,
  getOriginalStatus
} from '@/lib/types/domain/status'

import { BookmarkButton } from './bookmark-button'
import { EditHistoryButton } from './edit-history-button'
import { LikeButton } from './like-button'
import { PostMenu } from './post-menu'
import { ReplyButton } from './reply-button'
import { RepostButton } from './repost-button'

interface Props extends PostProps {
  onShowEdits?: (status: Status) => void
}

export const Actions: FC<Props> = ({
  host,
  currentActor,
  currentTime,
  status,
  editable = false,
  showActions = false,
  onReply,
  onEdit,
  onShowEdits,
  onPostDeleted,
  onBookmarkChanged
}) => {
  if (!showActions) return null
  if (!currentActor) return null

  const actualStatus =
    status.type === StatusType.enum.Announce
      ? getOriginalStatus(status)
      : status
  const canEdit = editable && status.type !== StatusType.enum.Announce
  const isOwner =
    Boolean(actualStatus.isLocalActor) &&
    currentActor.id === actualStatus.actorId
  const hasEditHistory = actualStatus.edits.length > 0

  const primaryActions: ReactNode[] = [
    <ReplyButton key="reply" status={actualStatus} onReply={onReply} />,
    <RepostButton
      key="repost"
      currentActor={currentActor}
      status={actualStatus}
    />,
    <LikeButton
      key={`${actualStatus.id}-like`}
      currentActor={currentActor}
      status={actualStatus}
    />,
    <BookmarkButton
      key="bookmark"
      status={actualStatus}
      onBookmarkChanged={onBookmarkChanged}
    />
  ]

  if (hasEditHistory) {
    primaryActions.push(
      <EditHistoryButton
        key="edit-history"
        status={actualStatus}
        host={host}
        currentTime={currentTime}
        onShowEdits={onShowEdits}
      />
    )
  }

  return (
    <div className="mt-3 flex items-center gap-5 text-muted-foreground sm:gap-6">
      <div
        role="group"
        aria-label="Post primary actions"
        className="flex items-center gap-5 sm:gap-6"
      >
        {primaryActions}
      </div>

      <PostMenu
        status={actualStatus}
        isOwner={isOwner}
        canEdit={canEdit}
        onReply={onReply}
        onEdit={onEdit}
        onPostDeleted={onPostDeleted}
      />
    </div>
  )
}
