import { Heart } from 'lucide-react'
import { FC, useEffect, useState } from 'react'

import { likeStatus, undoLikeStatus } from '@/lib/client'
import { ActorProfile } from '@/lib/types/domain/actor'
import { StatusNote, StatusPoll } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'

interface LikeButtonProps {
  currentActor?: ActorProfile
  status: StatusNote | StatusPoll
}

const LIKE_ERROR_DISMISS_MS = 4000

export const LikeButton: FC<LikeButtonProps> = ({ currentActor, status }) => {
  const [isActorLiked, setIsActorLiked] = useState<boolean>(status.isActorLiked)
  const [totalLikes, setTotalLikes] = useState<number>(status.totalLikes)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setIsActorLiked(status.isActorLiked)
    setTotalLikes(status.totalLikes)
    setError(null)
  }, [status.isActorLiked, status.totalLikes])

  useEffect(() => {
    if (!error) return

    const timeoutId = setTimeout(() => {
      setError(null)
    }, LIKE_ERROR_DISMISS_MS)

    return () => clearTimeout(timeoutId)
  }, [error])

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
          'flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-1 text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50',
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

            setIsActorLiked(nextIsActorLiked)
            setTotalLikes((prev) =>
              nextIsActorLiked ? prev + 1 : Math.max(0, prev - 1)
            )
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
      {error ? (
        <span
          className="pointer-events-none absolute right-0 top-full z-10 mt-1 w-max max-w-[min(12rem,calc(100vw-2rem))] break-words rounded-md border bg-background px-2 py-1 text-left text-xs text-destructive shadow-sm"
          data-testid="like-error"
          role="alert"
        >
          {error}
        </span>
      ) : null}
    </span>
  )
}
