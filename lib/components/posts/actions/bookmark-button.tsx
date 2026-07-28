import { Bookmark } from 'lucide-react'
import { FC } from 'react'

import {
  ACTION_BUTTON_CLASS,
  ActionButtonError
} from '@/lib/components/posts/actions/actionButtonShared'
import { cn } from '@/lib/utils'

import { BookmarkState } from './useBookmarkState'

interface BookmarkButtonProps {
  state: BookmarkState
}

export const BookmarkButton: FC<BookmarkButtonProps> = ({ state }) => {
  const { isBookmarked, isLoading, error, label, toggle } = state

  return (
    <span className="relative inline-flex items-center justify-center">
      <button
        title={label}
        aria-label={label}
        disabled={isLoading}
        className={cn(
          ACTION_BUTTON_CLASS,
          isBookmarked ? 'text-amber-500' : 'hover:text-amber-500'
        )}
        onClick={(e) => {
          e.stopPropagation()
          void toggle()
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
