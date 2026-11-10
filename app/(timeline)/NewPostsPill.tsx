'use client'

import { ArrowUp, RefreshCw } from 'lucide-react'
import { FC, useSyncExternalStore } from 'react'

import { ScrollToTopButton } from '@/lib/components/scroll-to-top-button'
import { Button } from '@/lib/components/ui/button'

// A feed row whose bottom edge is above this line (just under the sticky
// header) has scrolled out of view upwards; the line the scroll anchor uses.
export const VIEW_TOP_EDGE = 80

/**
 * Posts that loaded above the reader (a refresh while scrolled down, or the
 * saved timeline reopening under a fresher first page) and have not been
 * scrolled into view yet.
 *
 * It lives outside React state so that counting down while the reader scrolls
 * re-renders only the pill, not the whole feed.
 */
export interface UnseenAboveStore {
  add: (statusIds: Iterable<string>) => void
  clear: () => void
  /**
   * Keeps only the unseen posts in rows that are above the screen; a post
   * whose row is on screen or below it is seen. Feed rows carry every status
   * id they show in `data-row-status-ids`, so a thread or conversation row
   * counts all of its posts.
   */
  recount: () => void
  subscribe: (listener: () => void) => () => void
  getCount: () => number
}

export const createUnseenAboveStore = (): UnseenAboveStore => {
  let unseen = new Set<string>()
  let count = 0
  const listeners = new Set<() => void>()
  const setCount = (next: number) => {
    if (next === count) return
    count = next
    listeners.forEach((listener) => listener())
  }

  return {
    add: (statusIds) => {
      for (const id of statusIds) unseen.add(id)
    },
    clear: () => {
      unseen = new Set()
      setCount(0)
    },
    recount: () => {
      if (unseen.size === 0) {
        setCount(0)
        return
      }
      if (typeof document === 'undefined') return
      const rows = document.querySelectorAll<HTMLElement>(
        '[data-row-status-ids]'
      )
      // Nothing rendered to measure against yet: keep the count as it is.
      if (rows.length === 0) return

      const stillAbove = new Set<string>()
      for (let i = 0; i < rows.length; i++) {
        const ids = (rows[i].getAttribute('data-row-status-ids') ?? '')
          .split(' ')
          .filter((id) => unseen.has(id))
        if (ids.length === 0) continue
        const rect = rows[i].getBoundingClientRect()
        if (rect.bottom > rect.top && rect.bottom <= VIEW_TOP_EDGE) {
          for (const id of ids) stillAbove.add(id)
        }
      }
      unseen = stillAbove
      setCount(stillAbove.size)
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getCount: () => count
  }
}

const useUnseenAboveCount = (store: UnseenAboveStore) =>
  useSyncExternalStore(store.subscribe, store.getCount, () => 0)

interface NewPostsPillProps {
  store: UnseenAboveStore
  /** Newer posts the poll found that are not loaded yet. */
  polledCount: number
  /** Whether the reader is scrolled down below the top of the feed. */
  isScrolledDown?: boolean
  /** Whether the background poll reached its page limit for newer posts. */
  hasMorePolled?: boolean
  /** Whether a background timeline refresh is currently in flight. */
  isRefreshing?: boolean
  onJump: () => void
}

/**
 * The floating pill under the timeline header: shows "N new posts" for posts
 * loaded above the reader plus the polled ones (counting down as the reader
 * scrolls up through them), or "Back to top" when the reader is scrolled down
 * with no unseen posts above.
 */
export const NewPostsPill: FC<NewPostsPillProps> = ({
  store,
  polledCount,
  isScrolledDown = false,
  hasMorePolled = false,
  isRefreshing = false,
  onJump
}) => {
  const total = useUnseenAboveCount(store) + polledCount
  if (total === 0 && !isScrolledDown) return null
  if (total > 0) {
    return (
      <Button
        type="button"
        variant="pill"
        onClick={onJump}
        className="pointer-events-auto h-9 gap-2 bg-popover pl-3 pr-4 text-popover-foreground shadow-lg dark:bg-popover dark:hover:bg-accent animate-in fade-in-0 slide-in-from-top-1 duration-200"
      >
        <ArrowUp className="text-muted-foreground" aria-hidden="true" />
        {total}
        {hasMorePolled ? '+' : ''} new{' '}
        {total === 1 && !hasMorePolled ? 'post' : 'posts'}
      </Button>
    )
  }
  return (
    <Button
      type="button"
      variant="pill"
      onClick={onJump}
      aria-busy={isRefreshing || undefined}
      className="pointer-events-auto h-9 gap-2 bg-popover pl-3 pr-4 text-popover-foreground shadow-lg dark:bg-popover dark:hover:bg-accent animate-in fade-in-0 slide-in-from-top-1 duration-200"
    >
      {isRefreshing ? (
        <RefreshCw
          className="animate-spin text-muted-foreground"
          aria-hidden="true"
        />
      ) : (
        <ArrowUp className="text-muted-foreground" aria-hidden="true" />
      )}
      Back to top
    </Button>
  )
}

interface TimelineScrollToTopButtonProps {
  store: UnseenAboveStore
  polledCount: number
  isScrolledDown?: boolean
  isLoadMoreVisible: boolean
}

/** The phone's "Scroll to top", hidden while the pill offers the way up. */
export const TimelineScrollToTopButton: FC<TimelineScrollToTopButtonProps> = ({
  store,
  polledCount,
  isScrolledDown = false,
  isLoadMoreVisible
}) => {
  const total = useUnseenAboveCount(store) + polledCount
  return (
    <ScrollToTopButton
      isLoadMoreVisible={isLoadMoreVisible}
      isHidden={total > 0 || Boolean(isScrolledDown)}
    />
  )
}
