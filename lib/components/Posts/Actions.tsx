import { FC } from 'react'

import {
  deleteStatus
} from '../../client'
import { StatusType } from '../../models/status'
import { Button } from '../Button'
import { LikeButton } from './Actions/LikeButton'
import { RepostButton } from './Actions/RepostButton'
import { PostProps } from './Post'


export const Actions: FC<PostProps> = ({
  currentActor,
  status,
  showDeleteAction = false,
  showActions = false,
  onReply,
  onPostDeleted,
  onPostReposted
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
      </div>
    )
  }

  return (
    <div>
      <Button variant="link" onClick={() => onReply?.(status)}>
        <i className="bi bi-reply" />
      </Button>
      <RepostButton
        currentActor={currentActor}
        status={status}
        onPostReposted={onPostReposted}
      />
      <LikeButton currentActor={currentActor} status={status} />
      {showDeleteAction && (
        <Button
          variant="link"
          onClick={async () => {
            const deleteConfirmation = window.confirm(
              `Confirm delete status! ${
                status.text.length
                  ? `${status.text.slice(0, 20)}...`
                  : status.id
              }`
            )
            if (!deleteConfirmation) return
            await deleteStatus({ statusId: status.id })
            onPostDeleted?.(status)
          }}
        >
          <i className="bi bi-trash3" />
        </Button>
      )}
    </div>
  )
}
