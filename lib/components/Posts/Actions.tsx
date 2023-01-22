import cn from 'classnames'
import { FC, useState } from 'react'

import { deleteStatus, repostStatus, undoRepostStatus } from '../../client'
import { ActorProfile } from '../../models/actor'
import { StatusData, StatusType } from '../../models/status'
import { Button } from '../Button'
import styles from './Actions.module.scss'
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
          const boostedStatusId = mainStatus.boostedByStatusesId.find(
            (statusId) => statusId.startsWith(currentActor.id)
          )
          if (!boostedStatusId) return
          setIsLoading(true)
          await undoRepostStatus({ statusId: boostedStatusId })
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

interface LikeButtonProps {
  currentActor?: ActorProfile
  status: StatusData
}
const LikeButton: FC<LikeButtonProps> = ({ currentActor, status }) => {
  return (
    <span>
      <Button variant="link" disabled={status.actorId === currentActor?.id}>
        <i className="bi bi-star" />
      </Button>
      {status.type === StatusType.Note && status.totalLikes > 0 && (
        <span className={styles['like-count']}>{status.totalLikes}</span>
      )}
    </span>
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
