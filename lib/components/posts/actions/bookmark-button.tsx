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

export const BookmarkButton: FC<BookmarkButtonProps> = ({
  status,
  onBookmarkChanged
}) => {
  const [isBookmarked, setIsBookmarked] = useState<boolean>(
    status.isActorBookmarked
  )
  const [isLoading, setIsLoading] = useState<boolean>(false)

  useEffect(() => {
    setIsBookmarked(status.isActorBookmarked)
  }, [status.isActorBookmarked])

  const bookmarkLabel = isBookmarked ? 'Remove bookmark' : 'Bookmark'

  return (
    <button
      title={bookmarkLabel}
      aria-label={bookmarkLabel}
      disabled={isLoading}
      className={cn(
        'flex items-center gap-1.5 rounded-full px-2 py-1 text-sm transition-colors hover:bg-muted',
        isBookmarked ? 'text-amber-500' : 'hover:text-amber-500'
      )}
      onClick={async (e) => {
        e.stopPropagation()
        if (isLoading) return

        setIsLoading(true)
        try {
          if (isBookmarked) {
            if (await undoBookmarkStatus({ statusId: status.id })) {
              setIsBookmarked(false)
              onBookmarkChanged?.(status, false)
            }
            return
          }

          if (await bookmarkStatus({ statusId: status.id })) {
            setIsBookmarked(true)
            onBookmarkChanged?.(status, true)
          }
        } finally {
          setIsLoading(false)
        }
      }}
    >
      <Bookmark className={cn('h-4 w-4', { 'fill-current': isBookmarked })} />
    </button>
  )
}
