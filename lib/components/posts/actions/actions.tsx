import { FC, ReactNode } from 'react'

import { PostProps } from '@/lib/components/posts/post'
import {
  Status,
  StatusType,
  getOriginalStatus
} from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'

import { DeleteButton } from './delete-button'
import { EditButton } from './edit-button'
import { EditHistoryButton } from './edit-history-button'
import { LikeButton } from './like-button'
import { ReplyButton } from './reply-button'
import { RepostButton } from './repost-button'
import { VisibilityButton } from './visibility-button'

interface Props extends PostProps {
  onShowEdits?: (status: Status) => void
}

const actionRowClassName =
  'grid w-full items-center justify-items-center gap-2 sm:flex sm:w-auto sm:justify-start sm:gap-6'

export const Actions: FC<Props> = ({
  host,
  currentActor,
  status,
  editable = false,
  showActions = false,
  onReply,
  onEdit,
  onShowEdits,
  onPostDeleted
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
    <LikeButton key="like" currentActor={currentActor} status={actualStatus} />
  ]
  const secondaryActions: ReactNode[] = []

  if (hasEditHistory) {
    primaryActions.push(
      <EditHistoryButton
        key="edit-history"
        status={actualStatus}
        host={host}
        onShowEdits={onShowEdits}
      />
    )
  }

  if (isOwner) {
    secondaryActions.push(
      <VisibilityButton key="visibility" status={actualStatus} />
    )
  }

  if (canEdit) {
    secondaryActions.push(
      <EditButton key="edit" status={actualStatus} onEdit={onEdit} />,
      <DeleteButton
        key="delete"
        status={actualStatus}
        onPostDeleted={onPostDeleted}
      />
    )
  }

  const hasSecondaryActions = secondaryActions.length > 0
  const actionColumnClassName = hasEditHistory ? 'grid-cols-4' : 'grid-cols-3'

  return (
    <div className="mt-3 flex flex-col gap-2 text-muted-foreground sm:flex-row sm:items-center sm:gap-6">
      <div
        role="group"
        aria-label="Post primary actions"
        className={cn(actionRowClassName, actionColumnClassName)}
      >
        {primaryActions}
      </div>

      {hasSecondaryActions && (
        <div
          role="group"
          aria-label="Post secondary actions"
          className={cn(actionRowClassName, actionColumnClassName)}
        >
          {secondaryActions}
        </div>
      )}
    </div>
  )
}
