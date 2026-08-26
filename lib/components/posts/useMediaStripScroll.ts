'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Sub-pixel scroll offsets — and a scroller whose content is a hair wider than
 * its box — must not flicker the edge affordances on and off, so each end has a
 * dead zone before it counts as scrollable.
 */
export const SCROLL_EDGE_TOLERANCE = 8

/** How much of the visible strip one chevron press travels. */
const SCROLL_PAGE_RATIO = 0.7

interface MediaStripScroll {
  /**
   * Attach to the scroll container. A callback ref rather than a ref object:
   * the strip is only rendered for two or more attachments, and a ref object
   * assigned after the first render re-runs no effect, so the observer would
   * never attach.
   */
  ref: (element: HTMLDivElement | null) => void
  canScrollLeft: boolean
  canScrollRight: boolean
  /** Re-read the scroll position — wire to the container's `onScroll`. */
  measure: () => void
  scrollByPage: (direction: 1 | -1) => void
}

/**
 * Tracks whether a horizontal media strip has more content past either edge.
 *
 * It measures the strip's own scroll container rather than the viewport, for
 * the same reason `useCompactActionBar` and `useGearTableColumns` do — a post
 * can sit in a narrow column on a wide window, and a viewport breakpoint would
 * answer for the wrong box.
 *
 * `contentKey` must describe the laid-out width of everything inside the strip,
 * not merely how many things there are. The observer watches the CONTAINER, and
 * editing a post to swap a panorama for a portrait changes what overflows
 * without changing the container's box, the item count, or `scrollLeft` — so a
 * count would leave a forward chevron pointing at content that no longer exists
 * and the edge fade dimming a photo for no reason.
 */
export const useMediaStripScroll = (contentKey: string): MediaStripScroll => {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const [edges, setEdges] = useState({ left: false, right: false })

  const measure = useCallback(() => {
    if (!element) return
    const maxScrollLeft = element.scrollWidth - element.clientWidth
    const next = {
      left: element.scrollLeft > SCROLL_EDGE_TOLERANCE,
      right: element.scrollLeft < maxScrollLeft - SCROLL_EDGE_TOLERANCE
    }
    // Preserve the previous object when nothing changed: a scroll produces a
    // burst of events and each one would otherwise re-render the whole strip.
    setEdges((previous) =>
      previous.left === next.left && previous.right === next.right
        ? previous
        : next
    )
  }, [element])

  useEffect(() => {
    if (!element) return
    measure()
    // jsdom and any SSR pass have no ResizeObserver; the strip still scrolls,
    // it just keeps whatever the eager measurement above found.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [contentKey, element, measure])

  const scrollByPage = useCallback(
    (direction: 1 | -1) => {
      if (!element) return
      element.scrollBy({
        left: direction * Math.round(element.clientWidth * SCROLL_PAGE_RATIO),
        behavior: 'smooth'
      })
    },
    [element]
  )

  return {
    ref: setElement,
    canScrollLeft: edges.left,
    canScrollRight: edges.right,
    measure,
    scrollByPage
  }
}
