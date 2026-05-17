import { Heart } from 'lucide-react'
import { FC, useState } from 'react'

import { likeStatus, undoLikeStatus } from '@/lib/client'
import { ActorProfile } from '@/lib/types/domain/actor'
import { StatusNote, StatusPoll } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'

interface LikeButtonProps {
  currentActor?: ActorProfile
  status: StatusNote | StatusPoll
}
export const LikeButton: FC<LikeButtonProps> = ({ currentActor, status }) => {
  const [isActorLiked, setIsActorLiked] = useState<boolean>(status.isActorLiked)
  const [totalLikes, setTotalLikes] = useState<number>(status.totalLikes)
  const likeLabel =
    totalLikes > 0
      ? `${isActorLiked ? 'Unlike' : 'Like'}, ${totalLikes} ${
          totalLikes === 1 ? 'like' : 'likes'
        }`
      : isActorLiked
        ? 'Unlike'
        : 'Like'

  return (
    <button
      title={likeLabel}
      aria-label={likeLabel}
      disabled={status.actorId === currentActor?.id}
      className={cn(
        'flex items-center gap-1.5 rounded-full px-2 py-1 text-sm transition-colors hover:bg-muted',
        isActorLiked ? 'text-red-500' : 'hover:text-red-500'
      )}
      onClick={async (e) => {
        e.stopPropagation()
        if (isActorLiked) {
          await undoLikeStatus({ statusId: status.id })
          setIsActorLiked(false)
          setTotalLikes((prev) => prev - 1)
          return
        }
        await likeStatus({ statusId: status.id })
        setIsActorLiked(true)
        setTotalLikes((prev) => prev + 1)
      }}
    >
      <Heart className={cn('h-4 w-4', { 'fill-current': isActorLiked })} />
      {totalLikes > 0 && <span>{totalLikes}</span>}
    </button>
  )
}
