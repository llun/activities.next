import cn from 'classnames'
import { FC, useState } from 'react'

import {
  deleteStatus,
  likeStatus,
  repostStatus,
  undoLikeStatus,
  undoRepostStatus
} from '../../client'
import { ActorProfile } from '../../models/actor'
import { StatusData, StatusNote, StatusType } from '../../models/status'
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

  if (!currentActor) return null
  return (
    <Button
      disabled={isLoading}
      variant="link"
      className={cn({ 'text-danger': mainStatus.isActorAnnounced })}
      onClick={async () => {
        if (isLoading) return

        if (mainStatus.isActorAnnounced) {
          setIsLoading(true)
          await undoRepostStatus({ statusId: mainStatus.id })
          setIsLoading(false)
          // TODO: Reload?
          return
        }
        setIsLoading(true)
        await repostStatus({ statusId: status.id })
        onPostReposted?.(status)
        // TODO: Reload?
        setIsLoading(false)
      }}
    >
      <i className="bi bi bi-repeat"></i>
    </Button>
  )
}

interface LikeButtonProps {
  currentActor?: ActorProfile
  status: StatusNote
}
const LikeButton: FC<LikeButtonProps> = ({ currentActor, status }) => {
  const [isActorLiked, setIsActorLiked] = useState<boolean>(status.isActorLiked)
  return (
    <span>
      <Button
        variant="link"
        disabled={status.actorId === currentActor?.id}
        onClick={async () => {
          if (isActorLiked) {
            await undoLikeStatus({ statusId: status.id })
            setIsActorLiked(false)
            return
          }
          await likeStatus({ statusId: status.id })
          setIsActorLiked(true)
        }}
      >
        <i
          className={cn('bi', {
            'bi-star': !isActorLiked,
            'bi-star-fill': isActorLiked
          })}
        />
      </Button>
      {status.type === StatusType.Note &&
        status.actorId === currentActor?.id &&
        status.totalLikes > 0 && (
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
