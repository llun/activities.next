'use client'

import { useEffect, useRef } from 'react'

/**
 * Scrolls the opened post to the top of the viewport on the page's first
 * render, when posts of its conversation are drawn above it (the post page's
 * ancestors, the activity page's), so the reader lands on the post they
 * opened rather than on the top of the thread. It runs once: a later load of
 * earlier posts keeps the post still instead (`useThreadContextPager`). A URL
 * with a `#anchor` is left to the browser, and the scroll is instant, not
 * smooth. Inside a self-thread run the opened part (`aria-current`) is the
 * target, so the run's parts before it stay above.
 */
export const useScrollOpenedPostIntoView = (
  getOpenedPost: () => HTMLElement | null,
  hasPostsAbove: boolean
) => {
  // The first render's values: this is a landing, not a reaction to updates.
  const firstRef = useRef({ getOpenedPost, hasPostsAbove })
  useEffect(() => {
    if (!firstRef.current.hasPostsAbove) return
    if (window.location.hash) return
    const container = firstRef.current.getOpenedPost()
    const target =
      container?.querySelector<HTMLElement>(
        '[data-testid="self-thread-run"] [aria-current="location"]'
      ) ?? container
    if (!target || typeof target.scrollIntoView !== 'function') return
    target.scrollIntoView({ block: 'start', behavior: 'auto' })
  }, [])
}
