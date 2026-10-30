import { Bookmark } from 'lucide-react'
import { FC } from 'react'

import {
  ACTION_BUTTON_CLASS,
  ActionButtonError
} from '@/lib/components/posts/actions/actionButtonShared'
import { cn } from '@/lib/utils'

import { BookmarkState, getBookmarkLabel } from './useBookmarkState'

interface BookmarkButtonProps {
  state: BookmarkState
  /** Names the post when the row's buttons act on different ones. */
  targetLabel?: string
}

export const BookmarkButton: FC<BookmarkButtonProps> = ({
  state,
  targetLabel
}) => {
  const { isBookmarked, isLoading, error, toggle } = state
  const label = getBookmarkLabel(isBookmarked, targetLabel)

  return (
    <span className="relative inline-flex items-center justify-center">
      <button
        title={label}
        aria-label={label}
        disabled={isLoading}
        className={cn(
          ACTION_BUTTON_CLASS,
          isBookmarked ? 'text-bookmark-icon' : 'hover:text-bookmark-icon'
        )}
        onClick={(e) => {
          e.stopPropagation()
          void toggle()
        }}
      >
        <Bookmark className={cn('h-4 w-4', { 'fill-current': isBookmarked })} />
      </button>
      {error ? (
        <ActionButtonError
          message={error}
          testId="bookmark-error"
          align="center"
        />
      ) : null}
    </span>
  )
}
