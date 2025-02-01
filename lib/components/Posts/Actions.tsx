import cn from 'classnames'
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
  onPostReposted,
  onShowEdits,
  onPostDeleted
}) => {
  if (!showActions) return null
  if (!currentActor) return null

  if (status.type === StatusType.enum.Announce) {
    return (
      <div>
        <ReplyButton onReply={onReply} status={status.originalStatus} />
        <RepostButton
          currentActor={currentActor}
          status={status.originalStatus}
          onPostReposted={onPostReposted}
        />
        <LikeButton
          currentActor={currentActor}
          status={status.originalStatus}
        />
        <EditHistoryButton
          host={host}
          status={status.originalStatus}
          onShowEdits={onShowEdits}
        />
      </div>
    )
  }

  return (
    <div>
      <ReplyButton status={status} onReply={onReply} />
      <RepostButton
        currentActor={currentActor}
        status={status}
        onPostReposted={onPostReposted}
      />
      <LikeButton currentActor={currentActor} status={status} />
      <EditHistoryButton
        status={status}
        host={host}
        onShowEdits={onShowEdits}
      />
      <EditButton
        status={status}
        className={cn({ 'd-none': !editable })}
        onEdit={onEdit}
      />
      <DeleteButton
        className={cn({ 'd-none': !editable })}
        status={status}
        onPostDeleted={onPostDeleted}
      />
    </div>
  )
}
