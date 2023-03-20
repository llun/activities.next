import cn from 'classnames'
import { FC, useState } from 'react'

import { likeStatus, undoLikeStatus } from '../../../client'
import { ActorProfile } from '../../../models/actor'
import { StatusNote, StatusPoll, StatusType } from '../../../models/status'
import { Button } from '../../Button'
import styles from './LikeButton.module.scss'

interface LikeButtonProps {
  currentActor?: ActorProfile
  status: StatusNote | StatusPoll
}
export const LikeButton: FC<LikeButtonProps> = ({ currentActor, status }) => {
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
