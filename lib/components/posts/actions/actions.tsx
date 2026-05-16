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

const statusActionGridColumnsByCount: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4'
}

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
  const statusActions: ReactNode[] = []

  if (hasEditHistory) {
    statusActions.push(
      <EditHistoryButton
        key="edit-history"
        status={actualStatus}
        host={host}
        onShowEdits={onShowEdits}
      />
    )
  }

  if (isOwner) {
    statusActions.push(
      <VisibilityButton key="visibility" status={actualStatus} />
    )
  }

  if (canEdit) {
    statusActions.push(
      <EditButton key="edit" status={actualStatus} onEdit={onEdit} />,
      <DeleteButton
        key="delete"
        status={actualStatus}
        onPostDeleted={onPostDeleted}
      />
    )
  }

  const hasStatusActions = statusActions.length > 0
  const statusActionGridColumns =
    statusActionGridColumnsByCount[statusActions.length] ?? 'grid-cols-1'

  return (
    <div className="mt-3 flex flex-col gap-2 text-muted-foreground sm:flex-row sm:items-center sm:gap-6">
      <div
        role="group"
        aria-label="Post social actions"
        className="grid w-full grid-cols-3 items-center justify-items-center gap-2 sm:flex sm:w-auto sm:justify-start sm:gap-6"
      >
        <ReplyButton status={actualStatus} onReply={onReply} />
        <RepostButton currentActor={currentActor} status={actualStatus} />
        <LikeButton currentActor={currentActor} status={actualStatus} />
      </div>

      {hasStatusActions && (
        <div
          role="group"
          aria-label="Post status actions"
          className={cn(
            'grid w-full items-center justify-items-center gap-2 sm:flex sm:w-auto sm:justify-start sm:gap-6',
            statusActionGridColumns
          )}
        >
          {statusActions}
        </div>
      )}
    </div>
  )
}
