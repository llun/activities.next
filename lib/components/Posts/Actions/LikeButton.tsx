import cn from 'classnames'
import { FC, useState } from 'react'

import {
  getStatusFavouritedBy,
  likeStatus,
  undoLikeStatus
} from '../../../client'
import { ActorProfile } from '../../../models/actor'
import { StatusNote, StatusPoll, StatusType } from '../../../models/status'
import { Button } from '../../Button'
import styles from './LikeButton.module.scss'

interface FavouritedByActor {
  acct: string
  url: string
}

interface LikeButtonProps {
  currentActor?: ActorProfile
  status: StatusNote | StatusPoll
}
export const LikeButton: FC<LikeButtonProps> = ({ currentActor, status }) => {
  const [isActorLiked, setIsActorLiked] = useState<boolean>(status.isActorLiked)
  const [showFavouritedBy, setShowFavouritedBy] = useState<boolean>(false)
  const [favouritedByActors, setFavouritedByActors] = useState<
    FavouritedByActor[]
  >([])

  return (
    <span>
      <Button
        variant="link"
        title={isActorLiked ? 'Unlike' : 'Like'}
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
      {status.type === StatusType.enum.Note &&
        status.actorId === currentActor?.id &&
        status.totalLikes > 0 && (
          <div className={styles['like-info']}>
            <span
              className={cn(styles['like-count'])}
              onClick={async () => {
                const url = new URL(status.id)
                const uuid = url.pathname.split('/').pop()
                if (!uuid) return
                const actors = await getStatusFavouritedBy({ uuid })
                setFavouritedByActors(actors)
                setShowFavouritedBy((current) => !current)
              }}
            >
              {status.totalLikes}
            </span>
            <div
              className={cn(styles['favourited-by'], {
                'd-none': !showFavouritedBy
              })}
            >
              <ul className="list-group">
                {favouritedByActors.map((actor) => (
                  <li
                    key={actor.acct}
                    className={cn(
                      'list-group-item',
                      'd-flex',
                      'flex-column',
                      'align-items-start'
                    )}
                  >
                    <a
                      href={actor.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      @{actor.acct}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
    </span>
  )
}
