'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Sub-pixel scroll offsets — and a scroller whose content is a hair wider than
 * its box — must not flicker the edge affordances on and off, so each end has a
 * dead zone before it counts as scrollable.
 */
export const SCROLL_EDGE_TOLERANCE = 8

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
 * count would leave a forward arrow pointing at content that no longer exists
 * and an overflow affordance present for no reason.
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
      const maxScrollLeft = Math.max(
        0,
        element.scrollWidth - element.clientWidth
      )
      const current = element.scrollLeft
      const containerLeft = element.getBoundingClientRect().left
      // A snapport inset (`scroll-padding-left`) is where a `start`-aligned card
      // belongs, so each card's boundary over-scrolls by that inset. Subtract it
      // from the boundary before filtering — otherwise the padded first card
      // reads as a forward boundary at rest and "next" would scroll nowhere.
      // Subtracting after the filter would reintroduce exactly that. jsdom
      // returns no computed scroll padding, so tests keep raw boundaries.
      const parsedScrollPadding = Number.parseFloat(
        getComputedStyle(element).scrollPaddingLeft
      )
      const scrollPadding = Number.isFinite(parsedScrollPadding)
        ? parsedScrollPadding
        : 0
      const boundaries = Array.from(element.children)
        .map(
          (child) =>
            (child as HTMLElement).getBoundingClientRect().left -
            containerLeft +
            current -
            scrollPadding
        )
        .filter((offset) => Number.isFinite(offset))
      const candidates =
        direction > 0
          ? boundaries.filter((offset) => offset > current + 1)
          : boundaries.filter((offset) => offset < current - 1)
      const boundary =
        direction > 0 ? candidates[0] : candidates[candidates.length - 1]
      // A browser can report zero offsets while layout is pending. Use one
      // visible width as a conservative fallback until card boundaries exist;
      // once they do, the normal path always advances exactly one card.
      const fallbackTarget = current + direction * element.clientWidth
      const target = Math.max(
        0,
        Math.min(maxScrollLeft, boundary ?? fallbackTarget)
      )
      if (
        (direction < 0 && current <= 0) ||
        (direction > 0 && current >= maxScrollLeft)
      )
        return
      const left = target - current
      if (!left) return
      const reducedMotion =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      element.scrollBy({
        left,
        behavior: reducedMotion ? 'auto' : 'smooth'
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
