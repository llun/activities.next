'use client'

import { useEffect, useState } from 'react'

import { bookmarkStatus, undoBookmarkStatus } from '@/lib/client'
import { useDismissingError } from '@/lib/components/posts/actions/actionButtonShared'
import { StatusNote, StatusPoll } from '@/lib/types/domain/status'

export interface BookmarkState {
  isBookmarked: boolean
  isLoading: boolean
  error: string | null
  /** "Bookmark" / "Remove bookmark" — the button's label and the menu item's. */
  label: string
  toggle: () => Promise<void>
}

interface UseBookmarkStateParams {
  status: StatusNote | StatusPoll
  onBookmarkChanged?: (
    status: StatusNote | StatusPoll,
    isBookmarked: boolean
  ) => void
}

/**
 * Whether the viewer has bookmarked this status, owned by the action row rather
 * than the button. A post narrow enough to collapse its bar renders the
 * bookmark as a ⋯ menu item instead of a button, and the two must be the same
 * state: otherwise bookmarking on a wide window and then narrowing it would
 * show the menu offering "Bookmark" for a status that already is one.
 */
export const useBookmarkState = ({
  status,
  onBookmarkChanged
}: UseBookmarkStateParams): BookmarkState => {
  const [isBookmarked, setIsBookmarked] = useState<boolean>(
    status.isActorBookmarked
  )
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useDismissingError()

  useEffect(() => {
    setIsBookmarked(status.isActorBookmarked)
    setError(null)
  }, [status.isActorBookmarked, setError])

  const toggle = async () => {
    if (isLoading) return

    setIsLoading(true)
    setError(null)
    try {
      const nextIsBookmarked = !isBookmarked
      const success = isBookmarked
        ? await undoBookmarkStatus({ statusId: status.id })
        : await bookmarkStatus({ statusId: status.id })

      if (!success) {
        setError(
          isBookmarked
            ? 'Failed to remove bookmark. Please try again.'
            : 'Failed to bookmark post. Please try again.'
        )
        return
      }

      setIsBookmarked(nextIsBookmarked)
      onBookmarkChanged?.(status, nextIsBookmarked)
    } catch {
      setError(
        isBookmarked
          ? 'Failed to remove bookmark. Please try again.'
          : 'Failed to bookmark post. Please try again.'
      )
    } finally {
      setIsLoading(false)
    }
  }

  return {
    isBookmarked,
    isLoading,
    error,
    label: isBookmarked ? 'Remove bookmark' : 'Bookmark',
    toggle
  }
}
