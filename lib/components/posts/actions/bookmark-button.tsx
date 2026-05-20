import { Bookmark } from 'lucide-react'
import { FC, useEffect, useState } from 'react'

import { bookmarkStatus, undoBookmarkStatus } from '@/lib/client'
import { StatusNote, StatusPoll } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'

interface BookmarkButtonProps {
  status: StatusNote | StatusPoll
  onBookmarkChanged?: (
    status: StatusNote | StatusPoll,
    isBookmarked: boolean
  ) => void
}

const BOOKMARK_ERROR_DISMISS_MS = 4000

export const BookmarkButton: FC<BookmarkButtonProps> = ({
  status,
  onBookmarkChanged
}) => {
  const [isBookmarked, setIsBookmarked] = useState<boolean>(
    status.isActorBookmarked
  )
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setIsBookmarked(status.isActorBookmarked)
    setError(null)
  }, [status.isActorBookmarked])

  useEffect(() => {
    if (!error) return

    const timeoutId = setTimeout(() => {
      setError(null)
    }, BOOKMARK_ERROR_DISMISS_MS)

    return () => clearTimeout(timeoutId)
  }, [error])

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
          'flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-1 text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50',
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
        <span
          className="pointer-events-none absolute right-0 top-full z-10 mt-1 w-max max-w-[min(12rem,calc(100vw-2rem))] break-words rounded-md border bg-background px-2 py-1 text-left text-xs text-destructive shadow-sm"
          data-testid="bookmark-error"
          role="alert"
        >
          {error}
        </span>
      ) : null}
    </span>
  )
}
