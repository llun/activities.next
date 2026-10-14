'use client'

import { ArrowUp } from 'lucide-react'
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
        if (rows[i].getBoundingClientRect().bottom <= VIEW_TOP_EDGE) {
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
  onJump: () => void
}

/**
 * The floating "N new posts" pill under the timeline header: the posts loaded
 * above the reader plus the polled ones. It counts down as the reader scrolls
 * up through them.
 */
export const NewPostsPill: FC<NewPostsPillProps> = ({
  store,
  polledCount,
  onJump
}) => {
  const total = useUnseenAboveCount(store) + polledCount
  if (total === 0) return null
  return (
    <Button
      type="button"
      variant="pill"
      onClick={onJump}
      className="pointer-events-auto h-9 gap-2 bg-popover pl-3 pr-4 text-popover-foreground shadow-lg dark:bg-popover dark:hover:bg-accent animate-in fade-in-0 slide-in-from-top-1 duration-200"
    >
      <ArrowUp className="text-primary" aria-hidden="true" />
      {total} new {total === 1 ? 'post' : 'posts'}
    </Button>
  )
}

interface TimelineScrollToTopButtonProps {
  store: UnseenAboveStore
  polledCount: number
  isLoadMoreVisible: boolean
}

/** The phone's "Scroll to top", hidden while the pill offers the way up. */
export const TimelineScrollToTopButton: FC<TimelineScrollToTopButtonProps> = ({
  store,
  polledCount,
  isLoadMoreVisible
}) => {
  const total = useUnseenAboveCount(store) + polledCount
  return (
    <ScrollToTopButton
      isLoadMoreVisible={isLoadMoreVisible}
      isHidden={total > 0}
    />
  )
}
