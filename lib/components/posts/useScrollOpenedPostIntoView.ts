'use client'

import { useEffect, useRef } from 'react'

/** Set on the history entry once the page has landed on its opened post. */
export const OPENED_POST_LANDED_KEY = 'openedPostLanded'

const hasLandedFlag = (): boolean => {
  try {
    return Boolean(window.history.state?.[OPENED_POST_LANDED_KEY])
  } catch {
    return false
  }
}

// Keeps the router's own state on the entry; the empty title and no URL
// change nothing else.
const markLanded = () => {
  try {
    if (hasLandedFlag()) return
    window.history.replaceState(
      { ...window.history.state, [OPENED_POST_LANDED_KEY]: true },
      ''
    )
  } catch {
    // Without history the next visit lands again, which is harmless.
  }
}

// With manual scroll restoration (the home timeline sets it, and entries
// pushed from there keep it) the browser restores nothing, so an entry that
// was landed on is landed on again rather than left at whatever offset.
const browserRestoresScroll = (): boolean => {
  try {
    return window.history.scrollRestoration !== 'manual'
  } catch {
    return true
  }
}

/**
 * Scrolls the opened post to the top of the viewport on the page's first
 * render, when posts of its conversation are drawn above it (the post page's
 * ancestors, the activity page's), so the reader lands on the post they
 * opened rather than on the top of the thread. It runs once per history
 * entry: it marks the entry (`openedPostLanded` in `history.state`), so Back,
 * Forward and reload keep the browser's own scroll restore — except under
 * manual scroll restoration, where nothing is restored and the post is
 * landed on again. The mark is put back after a `router.refresh()` (whose
 * history write drops custom state) and on `pagehide`. A later load of
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
  // The path of the entry this page landed on (or found already landed on),
  // whose mark is kept.
  const landedPathRef = useRef<string | null>(null)

  useEffect(() => {
    if (!firstRef.current.hasPostsAbove) return
    if (window.location.hash) return
    if (hasLandedFlag() && browserRestoresScroll()) {
      landedPathRef.current = window.location.pathname
      return
    }
    const container = firstRef.current.getOpenedPost()
    const target =
      container?.querySelector<HTMLElement>(
        '[data-testid="self-thread-run"] [aria-current="location"]'
      ) ?? container
    if (!target || typeof target.scrollIntoView !== 'function') return
    target.scrollIntoView({ block: 'start', behavior: 'auto' })
    landedPathRef.current = window.location.pathname
    markLanded()
  }, [])

  // The router's history write after a refresh (an insertion effect, so it
  // runs before this in the same commit) replaces the entry's state without
  // custom keys: put the mark back while the entry is still this page's.
  useEffect(() => {
    const path = landedPathRef.current
    if (path === null || window.location.pathname !== path) return
    markLanded()
  })

  useEffect(() => {
    const onPageHide = () => {
      const path = landedPathRef.current
      if (path !== null && window.location.pathname === path) markLanded()
    }
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, [])
}
