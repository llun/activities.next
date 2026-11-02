import { Heart } from 'lucide-react'
import { FC, useEffect, useState } from 'react'

import { likeStatus, undoLikeStatus } from '@/lib/client'
import {
  ACTION_BUTTON_CLASS,
  ActionButtonError,
  OFFLINE_MESSAGE,
  OfflineTooltip,
  useDismissingError,
  useIsOffline
} from '@/lib/components/posts/actions/actionButtonShared'
import { ActorProfile } from '@/lib/types/domain/actor'
import { StatusNote, StatusPoll } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'

interface LikeButtonProps {
  currentActor?: ActorProfile
  status: StatusNote | StatusPoll
  /** Names the post when the row's buttons act on different ones. */
  targetLabel?: string
  onLikeChanged?: (status: StatusNote | StatusPoll, isLiked: boolean) => void
  /** Which edge the failure message hangs from; `end` for a button at the right edge of its row. */
  errorAlign?: 'start' | 'end'
  /** `compact` keeps the button 24px tall with or without a count, for rows built around 24px. */
  size?: 'default' | 'compact'
}

export const LikeButton: FC<LikeButtonProps> = ({
  currentActor,
  status,
  targetLabel,
  onLikeChanged,
  errorAlign = 'start',
  size = 'default'
}) => {
  const [{ isActorLiked, totalLikes }, setLikeState] = useState({
    isActorLiked: status.isActorLiked,
    totalLikes: status.totalLikes
  })
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useDismissingError()
  const offline = useIsOffline()

  useEffect(() => {
    setLikeState({
      isActorLiked: status.isActorLiked,
      totalLikes: status.totalLikes
    })
    setError(null)
  }, [status.id, status.isActorLiked, status.totalLikes, setError])

  const isOwnPost = status.actorId === currentActor?.id
  const likeVerb = `${isActorLiked ? 'Unlike' : 'Like'}${
    targetLabel ? ` ${targetLabel}` : ''
  }`
  const likeLabel =
    totalLikes > 0
      ? `${likeVerb}, ${totalLikes} ${totalLikes === 1 ? 'like' : 'likes'}`
      : likeVerb
  const failureMessage = isActorLiked
    ? 'Failed to unlike post. Please try again.'
    : 'Failed to like post. Please try again.'

  return (
    <span className="relative inline-flex items-center justify-center">
      <OfflineTooltip offline={offline}>
        <button
          title={offline ? undefined : likeLabel}
          aria-label={likeLabel}
          disabled={isOwnPost || isLoading}
          aria-disabled={offline || undefined}
          className={cn(
            ACTION_BUTTON_CLASS,
            size === 'compact' && 'min-h-6 py-0.5',
            isActorLiked ? 'text-like-text' : 'hover:text-like-icon'
          )}
          onClick={async (e) => {
            e.stopPropagation()
            if (isOwnPost || isLoading) return
            if (offline) {
              setError(OFFLINE_MESSAGE)
              return
            }

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
          <Heart
            className={cn('h-4 w-4', {
              'fill-current text-like-icon': isActorLiked
            })}
          />
          {totalLikes > 0 && <span>{totalLikes}</span>}
        </button>
      </OfflineTooltip>
      {error ? (
        <ActionButtonError
          message={error}
          testId="like-error"
          align={errorAlign}
        />
      ) : null}
    </span>
  )
}
