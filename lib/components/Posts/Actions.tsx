import cn from 'classnames'
import { FC, useState } from 'react'

import { deleteStatus, repostStatus, undoRepostStatus } from '../../client'
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
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [isReposted, setIsReposted] = useState<boolean>(
    Boolean(
      status.type === StatusType.Note &&
        currentActor &&
        status.boostedByStatusesId.filter((item) =>
          item.includes(currentActor.domain)
        ).length > 0
    )
  )

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

  return (
    <div>
      <Button variant="link" onClick={() => onReply?.(status)}>
        <i className="bi bi-reply"></i>
      </Button>
      <Button
        disabled={isLoading}
        variant="link"
        className={cn({ 'text-danger': isReposted })}
        onClick={async () => {
          if (isLoading) return

          if (isReposted) {
            const boostedStatus = status.boostedByStatusesId
              .filter((item) => item.includes(currentActor.domain))
              .shift()
            if (!boostedStatus) return

            setIsLoading(true)
            await undoRepostStatus({ statusId: boostedStatus })
            setIsReposted(false)
            setIsLoading(false)
            return
          }
          setIsLoading(true)
          await repostStatus({ statusId: status.id })
          onPostReposted?.(status)
          setIsReposted(true)
          setIsLoading(false)
        }}
      >
        <i className="bi bi bi-repeat"></i>
      </Button>
      {showDeleteAction && (
        <Button
          variant="link"
          disabled={isLoading}
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
