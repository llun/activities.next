import { FC } from 'react'

import { Status, StatusType } from '../../models/status'
import { DeleteButton } from './Actions/DeleteButton'
import { EditButton } from './Actions/EditButton'
import { EditHistoryButton } from './Actions/EditHistoryButton'
import { LikeButton } from './Actions/LikeButton'
import { ReplyButton } from './Actions/ReplyButton'
import { RepostButton } from './Actions/RepostButton'
import { PostProps } from './Post'

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
        {editable && (
          <>
            <EditButton
              status={actualStatus}
              onEdit={onEdit}
            />
            <DeleteButton
              status={actualStatus}
              onPostDeleted={onPostDeleted}
            />
          </>
        )}
      </div>
    </div>
  )
}