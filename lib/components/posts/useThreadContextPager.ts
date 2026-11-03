'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'

import { StatusThreadPage, getStatusThread } from '@/lib/client'
import {
  THREAD_ANCESTORS_LIMIT_STEPS,
  THREAD_DESCENDANTS_LIMIT_STEPS,
  THREAD_INITIAL_ANCESTORS_LIMIT,
  THREAD_INITIAL_DESCENDANTS_LIMIT,
  getNextThreadLimit
} from '@/lib/services/statuses/threadPageLimits'

export type ThreadLoadDirection = 'ancestors' | 'descendants'

export interface UseThreadContextPagerParams {
  /** The opened status's id, as the page has it. */
  statusId: string
  /** The thread the page rendered, at the first limit step. */
  initial: StatusThreadPage
  /**
   * The element to keep still when earlier posts are added above it (the
   * opened post), so loading them does not push what the reader sees down.
   */
  getScrollAnchor?: () => HTMLElement | null
}

export interface ThreadContextPager extends StatusThreadPage {
  /** Set while there are more and a larger limit step is left. */
  loadMoreAncestors?: () => void
  loadMoreDescendants?: () => void
  loading: ThreadLoadDirection | null
  error: ThreadLoadDirection | null
}

const isSamePage = (a: StatusThreadPage, b: StatusThreadPage) =>
  a.ancestors === b.ancestors &&
  a.descendants === b.descendants &&
  a.hasMoreAncestors === b.hasMoreAncestors &&
  a.hasMoreDescendants === b.hasMoreDescendants

/**
 * The thread of the post page and the fitness activity page, with "Load
 * earlier posts" and "Load more replies". Each load asks the thread route for
 * the whole thread again at the next limit step in that direction (keeping the
 * other direction's limit) and replaces the thread with the answer, so the
 * statuses keep the shape and order the page rendered them in. Loads never
 * overlap, and one superseded by a newer page is dropped.
 *
 * When the page's own data changes (a `router.refresh()` after a reply), the
 * thread follows it while nothing more was loaded; after a load it re-asks
 * the route at the limits reached instead, so the reader keeps what they
 * loaded.
 */
export const useThreadContextPager = ({
  statusId,
  initial,
  getScrollAnchor
}: UseThreadContextPagerParams): ThreadContextPager => {
  const [page, setPage] = useState<StatusThreadPage>(initial)
  const [limits, setLimits] = useState({
    ancestors: THREAD_INITIAL_ANCESTORS_LIMIT as number,
    descendants: THREAD_INITIAL_DESCENDANTS_LIMIT as number
  })
  const [loading, setLoading] = useState<ThreadLoadDirection | null>(null)
  const [error, setError] = useState<ThreadLoadDirection | null>(null)
  const requestRef = useRef(0)
  const limitsRef = useRef(limits)
  limitsRef.current = limits
  const anchorRef = useRef<{ top: number } | null>(null)
  const getScrollAnchorRef = useRef(getScrollAnchor)
  getScrollAnchorRef.current = getScrollAnchor

  const request = useCallback(
    async (
      next: { ancestors: number; descendants: number },
      direction: ThreadLoadDirection | null
    ) => {
      // A newer request supersedes one still on its way, spinner included.
      const requestId = ++requestRef.current
      setLoading(direction)
      setError(null)
      try {
        const result = await getStatusThread({
          statusId,
          ancestorsLimit: next.ancestors,
          descendantsLimit: next.descendants
        })
        if (requestId !== requestRef.current) return
        if (direction === 'ancestors') {
          const anchor = getScrollAnchorRef.current?.()
          anchorRef.current = anchor
            ? { top: anchor.getBoundingClientRect().top }
            : null
        }
        setLimits(next)
        setPage(result)
      } catch {
        if (requestId !== requestRef.current) return
        if (direction) setError(direction)
      } finally {
        if (requestId === requestRef.current) setLoading(null)
      }
    },
    [statusId]
  )

  // Earlier posts land above the anchor: scroll by what they added, before
  // paint, so the anchor stays where the reader saw it.
  useLayoutEffect(() => {
    const saved = anchorRef.current
    if (!saved) return
    anchorRef.current = null
    const anchor = getScrollAnchorRef.current?.()
    if (!anchor || typeof window.scrollBy !== 'function') return
    const delta = anchor.getBoundingClientRect().top - saved.top
    if (delta !== 0) window.scrollBy(0, delta)
  }, [page])

  const lastInitialRef = useRef(initial)
  useEffect(() => {
    if (isSamePage(lastInitialRef.current, initial)) return
    lastInitialRef.current = initial
    const current = limitsRef.current
    if (
      current.ancestors === THREAD_INITIAL_ANCESTORS_LIMIT &&
      current.descendants === THREAD_INITIAL_DESCENDANTS_LIMIT
    ) {
      // A newer page drops any load still on its way.
      requestRef.current++
      setLoading(null)
      setPage(initial)
      return
    }
    void request(current, null)
  }, [initial, request])

  const nextAncestorsLimit = getNextThreadLimit(
    THREAD_ANCESTORS_LIMIT_STEPS,
    limits.ancestors
  )
  const nextDescendantsLimit = getNextThreadLimit(
    THREAD_DESCENDANTS_LIMIT_STEPS,
    limits.descendants
  )

  const loadMoreAncestors = useCallback(() => {
    if (loading || nextAncestorsLimit === null) return
    void request(
      {
        ancestors: nextAncestorsLimit,
        descendants: limitsRef.current.descendants
      },
      'ancestors'
    )
  }, [loading, nextAncestorsLimit, request])

  const loadMoreDescendants = useCallback(() => {
    if (loading || nextDescendantsLimit === null) return
    void request(
      {
        ancestors: limitsRef.current.ancestors,
        descendants: nextDescendantsLimit
      },
      'descendants'
    )
  }, [loading, nextDescendantsLimit, request])

  return {
    ...page,
    loadMoreAncestors:
      page.hasMoreAncestors && nextAncestorsLimit !== null
        ? loadMoreAncestors
        : undefined,
    loadMoreDescendants:
      page.hasMoreDescendants && nextDescendantsLimit !== null
        ? loadMoreDescendants
        : undefined,
    loading,
    error
  }
}
