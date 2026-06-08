import { Heart } from 'lucide-react'
import { FC, useEffect, useState } from 'react'

import { likeStatus, undoLikeStatus } from '@/lib/client'
import {
  ACTION_BUTTON_CLASS,
  ActionButtonError,
  useDismissingError
} from '@/lib/components/posts/actions/actionButtonShared'
import { ActorProfile } from '@/lib/types/domain/actor'
import { StatusNote, StatusPoll } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'

interface LikeButtonProps {
  currentActor?: ActorProfile
  status: StatusNote | StatusPoll
  onLikeChanged?: (status: StatusNote | StatusPoll, isLiked: boolean) => void
}

export const LikeButton: FC<LikeButtonProps> = ({
  currentActor,
  status,
  onLikeChanged
}) => {
  const [{ isActorLiked, totalLikes }, setLikeState] = useState({
    isActorLiked: status.isActorLiked,
    totalLikes: status.totalLikes
  })
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useDismissingError()

  useEffect(() => {
    setLikeState({
      isActorLiked: status.isActorLiked,
      totalLikes: status.totalLikes
    })
    setError(null)
  }, [status.id, status.isActorLiked, status.totalLikes, setError])

  const isOwnPost = status.actorId === currentActor?.id
  const likeLabel =
    totalLikes > 0
      ? `${isActorLiked ? 'Unlike' : 'Like'}, ${totalLikes} ${
          totalLikes === 1 ? 'like' : 'likes'
        }`
      : isActorLiked
        ? 'Unlike'
        : 'Like'
  const failureMessage = isActorLiked
    ? 'Failed to unlike post. Please try again.'
    : 'Failed to like post. Please try again.'

  return (
    <span className="relative inline-flex items-center justify-center">
      <button
        title={likeLabel}
        aria-label={likeLabel}
        disabled={isOwnPost || isLoading}
        className={cn(
          ACTION_BUTTON_CLASS,
          isActorLiked ? 'text-red-500' : 'hover:text-red-500'
        )}
        onClick={async (e) => {
          e.stopPropagation()
          if (isOwnPost || isLoading) return

          setIsLoading(true)
          setError(null)
          try {
            const nextIsActorLiked = !isActorLiked
            const success = isActorLiked
              ? await undoLikeStatus({ statusId: status.id })
              : await likeStatus({ statusId: status.id })

            if (success === false) {
              setError(failureMessage)
              return
            }

            setLikeState((prev) => {
              if (prev.isActorLiked === nextIsActorLiked) return prev

              return {
                isActorLiked: nextIsActorLiked,
                totalLikes: nextIsActorLiked
                  ? prev.totalLikes + 1
                  : Math.max(0, prev.totalLikes - 1)
              }
            })
            onLikeChanged?.(status, nextIsActorLiked)
          } catch {
            setError(failureMessage)
          } finally {
            setIsLoading(false)
          }
        }}
      >
        <Heart className={cn('h-4 w-4', { 'fill-current': isActorLiked })} />
        {totalLikes > 0 && <span>{totalLikes}</span>}
      </button>
      {error ? <ActionButtonError message={error} testId="like-error" /> : null}
    </span>
  )
}
