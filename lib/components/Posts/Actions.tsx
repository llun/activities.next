import cn from 'classnames'
import { FC } from 'react'

import { deleteStatus, repostStatus } from '../../client'
import { StatusType } from '../../models/status'
import { Button } from '../Button'
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
          <i className="bi bi-reply"></i>
        </Button>
      </div>
    )
  }

  const isReposted =
    status.boostedByStatusesId.filter((item) =>
      item.includes(currentActor.domain)
    ).length > 0

  return (
    <div>
      <Button variant="link" onClick={() => onReply?.(status)}>
        <i className="bi bi-reply"></i>
      </Button>
      <Button
        variant="link"
        className={cn({ 'text-danger': isReposted })}
        onClick={async () => {
          if (isReposted) {
            // TODO: Undo reposted
            return
          }
          await repostStatus({ statusId: status.id })
          onPostReposted?.(status)
        }}
      >
        <i className="bi bi bi-repeat"></i>
      </Button>
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
          <i className="bi bi-trash3"></i>
        </Button>
      )}
    </div>
  )
}
