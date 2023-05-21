import cn from 'classnames'
import { FC } from 'react'

import { StatusData, StatusType } from '../../models/status'
import { Button } from '../Button'
import { DeleteButton } from './Actions/DeleteButton'
import { EditButton } from './Actions/EditButton'
import { EditHistoryButton } from './Actions/EditHistoryButton'
import { LikeButton } from './Actions/LikeButton'
import { RepostButton } from './Actions/RepostButton'
import { PostProps } from './Post'

interface Props extends PostProps {
  onShowEdits?: (status: StatusData) => void
}

export const Actions: FC<Props> = ({
  currentActor,
  status,
  showDeleteAction = false,
  showActions = false,
  onReply,
  onPostDeleted,
  onPostReposted,
  onShowEdits
}) => {
  if (!showActions) return null
  if (!currentActor) return null

  if (status.type === StatusType.Announce) {
    return (
      <div>
        <Button variant="link" onClick={() => onReply?.(status.originalStatus)}>
          <i className="bi bi-reply" />
        </Button>
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
          status={status.originalStatus}
          onShowEdits={onShowEdits}
        />
      </div>
    )
  }

  return (
    <div>
      <Button variant="link" title="Reply" onClick={() => onReply?.(status)}>
        <i className="bi bi-reply" />
      </Button>
      <RepostButton
        currentActor={currentActor}
        status={status}
        onPostReposted={onPostReposted}
      />
      <LikeButton currentActor={currentActor} status={status} />
      <DeleteButton
        className={cn({ 'd-none': !showDeleteAction })}
        status={status}
        onPostDeleted={onPostDeleted}
      />
      <EditHistoryButton status={status} onShowEdits={onShowEdits} />
      <EditButton />
    </div>
  )
}
