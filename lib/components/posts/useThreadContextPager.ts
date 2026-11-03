'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import { StatusThreadPage, getStatusThread } from '@/lib/client'
import {
  THREAD_INITIAL_ANCESTORS_LIMIT,
  THREAD_INITIAL_DESCENDANTS_LIMIT,
  getNextThreadLimit,
  getThreadLimitSteps
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
  /**
   * Whether the reader is signed in. Signed out, the route stops at the
   * middle limit step, so the pager does too.
   */
  signedIn: boolean
}

type ThreadLimits = { ancestors: number; descendants: number }

export interface ThreadContextPager extends StatusThreadPage {
  /**
   * Set while there are more and a larger limit step is left, and, for
   * replies, after a failed load or refresh so its Retry can re-ask.
   */
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
 * statuses keep the shape and order the page rendered them in. Only the
 * newest request's answer is kept; an overtaken one is dropped.
 *
 * When the page's own data changes (a `router.refresh()` after a reply), the
 * thread follows it while nothing more was loaded or is loading; otherwise it
 * re-asks the route at the larger of the limits reached and the ones a load
 * on its way asked for (that load's spinner stays on), so the reader keeps
 * what they loaded and still gets what they asked for. A failed re-ask keeps
 * the thread as it was and shows the replies' error, whose Retry asks again.
 */
export const useThreadContextPager = ({
  statusId,
  initial,
  getScrollAnchor,
  signedIn
}: UseThreadContextPagerParams): ThreadContextPager => {
  const steps = useMemo(() => getThreadLimitSteps(signedIn), [signedIn])
  const [page, setPage] = useState<StatusThreadPage>(initial)
  const [limits, setLimits] = useState<ThreadLimits>({
    ancestors: THREAD_INITIAL_ANCESTORS_LIMIT as number,
    descendants: THREAD_INITIAL_DESCENDANTS_LIMIT as number
  })
  const [loading, setLoading] = useState<ThreadLoadDirection | null>(null)
  const [error, setError] = useState<ThreadLoadDirection | null>(null)
  const requestRef = useRef(0)
  // The request on its way, if any, so a refresh landing meanwhile keeps it.
  const pendingRef = useRef<{
    limits: ThreadLimits
    direction: ThreadLoadDirection | null
  } | null>(null)
  const limitsRef = useRef(limits)
  limitsRef.current = limits
  const anchorRef = useRef<{ top: number } | null>(null)
  const getScrollAnchorRef = useRef(getScrollAnchor)
  getScrollAnchorRef.current = getScrollAnchor

  const request = useCallback(
    async (next: ThreadLimits, direction: ThreadLoadDirection | null) => {
      // A newer request supersedes one still on its way, spinner included.
      const requestId = ++requestRef.current
      pendingRef.current = { limits: next, direction }
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
        limitsRef.current = next
        setLimits(next)
        setPage(result)
      } catch {
        if (requestId !== requestRef.current) return
        // A failed refresh (no direction) keeps the thread as it was and
        // says so under the replies, where Retry asks again.
        setError(direction ?? 'descendants')
      } finally {
        if (requestId === requestRef.current) {
          pendingRef.current = null
          setLoading(null)
        }
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
    const pending = pendingRef.current
    if (
      !pending &&
      current.ancestors === THREAD_INITIAL_ANCESTORS_LIMIT &&
      current.descendants === THREAD_INITIAL_DESCENDANTS_LIMIT
    ) {
      setError(null)
      setPage(initial)
      return
    }
    void request(
      pending
        ? {
            ancestors: Math.max(current.ancestors, pending.limits.ancestors),
            descendants: Math.max(
              current.descendants,
              pending.limits.descendants
            )
          }
        : current,
      pending?.direction ?? null
    )
  }, [initial, request])

  const nextAncestorsLimit = getNextThreadLimit(
    steps.ancestors,
    limits.ancestors
  )
  const nextDescendantsLimit = getNextThreadLimit(
    steps.descendants,
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

  const canRetryDescendants = error === 'descendants'
  const loadMoreDescendants = useCallback(() => {
    if (loading) return
    if (nextDescendantsLimit === null && !canRetryDescendants) return
    void request(
      {
        ancestors: limitsRef.current.ancestors,
        descendants: nextDescendantsLimit ?? limitsRef.current.descendants
      },
      'descendants'
    )
  }, [canRetryDescendants, loading, nextDescendantsLimit, request])

  return {
    ...page,
    loadMoreAncestors:
      page.hasMoreAncestors && nextAncestorsLimit !== null
        ? loadMoreAncestors
        : undefined,
    loadMoreDescendants:
      (page.hasMoreDescendants && nextDescendantsLimit !== null) ||
      canRetryDescendants
        ? loadMoreDescendants
        : undefined,
    loading,
    error
  }
}
