import { FC } from 'react'

import { Status, StatusType } from '../../../models/status'
import { PostProps } from '../post'
import { DeleteButton } from './delete-button'
import { EditButton } from './edit-button'
import { EditHistoryButton } from './edit-history-button'
import { LikeButton } from './like-button'
import { ReplyButton } from './reply-button'
import { RepostButton } from './repost-button'

interface Props extends PostProps {
  onShowEdits?: (status: Status) => void
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
    status.type === StatusType.enum.Announce ? status.originalStatus : status
  const canEdit = editable && status.type !== StatusType.enum.Announce

  return (
    <div className="mt-3 flex items-center gap-6 text-muted-foreground">
      <ReplyButton status={actualStatus} onReply={onReply} />
      <RepostButton currentActor={currentActor} status={actualStatus} />
      <LikeButton currentActor={currentActor} status={actualStatus} />

      <div className="flex items-center gap-2">
        <EditHistoryButton
          status={actualStatus}
          host={host}
          onShowEdits={onShowEdits}
        />
        {canEdit && (
          <>
            <EditButton status={actualStatus} onEdit={onEdit} />
            <DeleteButton status={actualStatus} onPostDeleted={onPostDeleted} />
          </>
        )}
      </div>
    </div>
  )
}
