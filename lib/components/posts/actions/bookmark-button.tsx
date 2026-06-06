import { Bookmark } from 'lucide-react'
import { FC, useEffect, useState } from 'react'

import { bookmarkStatus, undoBookmarkStatus } from '@/lib/client'
import {
  ACTION_BUTTON_CLASS,
  ActionButtonError,
  useDismissingError
} from '@/lib/components/posts/actions/actionButtonShared'
import { StatusNote, StatusPoll } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'

interface BookmarkButtonProps {
  status: StatusNote | StatusPoll
  onBookmarkChanged?: (
    status: StatusNote | StatusPoll,
    isBookmarked: boolean
  ) => void
}

export const BookmarkButton: FC<BookmarkButtonProps> = ({
  status,
  onBookmarkChanged
}) => {
  const [isBookmarked, setIsBookmarked] = useState<boolean>(
    status.isActorBookmarked
  )
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useDismissingError()

  useEffect(() => {
    setIsBookmarked(status.isActorBookmarked)
    setError(null)
  }, [status.isActorBookmarked, setError])

  const bookmarkLabel = isBookmarked ? 'Remove bookmark' : 'Bookmark'
  const failureMessage = isBookmarked
    ? 'Failed to remove bookmark. Please try again.'
    : 'Failed to bookmark post. Please try again.'

  return (
    <span className="relative inline-flex items-center justify-center">
      <button
        title={bookmarkLabel}
        aria-label={bookmarkLabel}
        disabled={isLoading}
        className={cn(
          ACTION_BUTTON_CLASS,
          isBookmarked ? 'text-amber-500' : 'hover:text-amber-500'
        )}
        onClick={async (e) => {
          e.stopPropagation()
          if (isLoading) return

          setIsLoading(true)
          setError(null)
          try {
            const nextIsBookmarked = !isBookmarked
            const success = isBookmarked
              ? await undoBookmarkStatus({ statusId: status.id })
              : await bookmarkStatus({ statusId: status.id })

            if (!success) {
              setError(failureMessage)
              return
            }

            setIsBookmarked(nextIsBookmarked)
            onBookmarkChanged?.(status, nextIsBookmarked)
          } catch {
            setError(failureMessage)
          } finally {
            setIsLoading(false)
          }
        }}
      >
        <Bookmark className={cn('h-4 w-4', { 'fill-current': isBookmarked })} />
      </button>
      {error ? (
        <ActionButtonError message={error} testId="bookmark-error" />
      ) : null}
    </span>
  )
}
