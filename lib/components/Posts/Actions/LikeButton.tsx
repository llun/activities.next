import { Star } from 'lucide-react'
import { FC, useState } from 'react'

import { getStatusFavouritedBy, likeStatus, undoLikeStatus } from '@/lib/client'
import { Button } from '@/lib/components/ui/button'
import { ActorProfile } from '@/lib/models/actor'
import { StatusNote, StatusPoll, StatusType } from '@/lib/models/status'
import { cn } from '@/lib/utils'

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
        <Star className={cn('size-4', { 'fill-current': isActorLiked })} />
      </Button>
      {status.type === StatusType.enum.Note &&
        status.actorId === currentActor?.id &&
        status.totalLikes > 0 && (
          <div
            className="cursor-pointer inline-block relative min-w-[1.25rem] text-center"
            onClick={async () => {
              const actors = await getStatusFavouritedBy({
                statusId: status.id
              })
              setFavouritedByActors(actors)
              setShowFavouritedBy((current) => !current)
            }}
          >
            <span className="align-middle text-primary">
              {status.totalLikes}
            </span>
            <div
              className={cn(
                'absolute left-0 w-[15rem] max-md:left-[-8rem] max-md:w-[18rem]',
                {
                  hidden: !showFavouritedBy
                }
              )}
            >
              <ul className="divide-y divide-border rounded-lg border bg-background">
                {favouritedByActors.map((actor) => (
                  <li
                    key={actor.acct}
                    className="flex flex-col items-start p-3"
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
