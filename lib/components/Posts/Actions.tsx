import cn from 'classnames'
import { FC, useState } from 'react'

import { deleteStatus, repostStatus, undoRepostStatus } from '../../client'
import { ActorProfile } from '../../models/actor'
import { StatusData, StatusType } from '../../models/status'
import { Button } from '../Button'
import { PostProps } from './Post'

interface RepostButtonProps {
  currentActor?: ActorProfile
  status: StatusData
  onPostReposted?: (status: StatusData) => void
}
const RepostButton: FC<RepostButtonProps> = ({
  currentActor,
  status,
  onPostReposted
}) => {
  const mainStatus =
    status.type === StatusType.Note ? status : status.originalStatus

  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [boostedStatusesId, setBoostedStatusesId] = useState<string[]>(
    mainStatus.boostedByStatusesId
  )

  if (!currentActor) return null

  const isBoosted = Boolean(
    boostedStatusesId.filter((item) => item.includes(currentActor.domain))
      .length > 0
  )

  return (
    <Button
      disabled={isLoading}
      variant="link"
      className={cn({ 'text-danger': isBoosted })}
      onClick={async () => {
        if (isLoading) return

        if (isBoosted) {
          setIsLoading(true)
          await undoRepostStatus({ statusId: mainStatus.id })
          // TODO: remove status id from boosted id list
          setIsLoading(false)
          return
        }
        setIsLoading(true)
        await repostStatus({ statusId: status.id })
        // TODO: Grab announce id from repostStatus
        onPostReposted?.(status)
        setIsLoading(false)
      }}
    >
      <i className="bi bi bi-repeat"></i>
    </Button>
  )
}

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
        <RepostButton
          currentActor={currentActor}
          status={status.originalStatus}
          onPostReposted={onPostReposted}
        />
      </div>
    )
  }

  return (
    <div>
      <Button variant="link" onClick={() => onReply?.(status)}>
        <i className="bi bi-reply"></i>
      </Button>
      <RepostButton
        currentActor={currentActor}
        status={status}
        onPostReposted={onPostReposted}
      />
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
