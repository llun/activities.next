'use client'

import { RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'

// The measurement has to land before the browser paints, or the calendar draws
// at its fallback size for a frame and then reflows. `useLayoutEffect` warns
// when React renders on the server, where there is nothing to measure anyway.
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * The content width of an element, in pixels, for sizing things to the column
 * the calendar actually sits in rather than the window (a viewport breakpoint
 * cannot see a narrow column on a wide screen).
 *
 * Reports `null` until a real width is known, which is always the case on the
 * server and wherever `ResizeObserver` is missing (jsdom). Callers render a
 * CSS fallback for `null` (container-query units) and switch to the measured
 * number, so the first paint and the hydrated one agree. A zero width means
 * the element was never laid out (a `display: none` ancestor, a detached
 * subtree), not that it is empty, so it is ignored rather than reported.
 *
 * Modelled on `useCompactActionBar`, which measures the same way.
 */
export const useElementWidth = <T extends HTMLElement = HTMLDivElement>(): [
  RefObject<T | null>,
  number | null
] => {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState<number | null>(null)

  useIsomorphicLayoutEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return

    const measure = (next: number) => {
      if (!(next > 0)) return
      // A fractional width changes every cell size by a sub-pixel amount and
      // would re-render the whole grid on each scrollbar flicker; whole pixels
      // are what the layout can show anyway.
      setWidth(Math.round(next))
    }

    // Measure here rather than leaving it to the observer's first delivery,
    // which lands after the first paint; a layout-effect update is flushed
    // before it.
    measure(element.getBoundingClientRect().width)

    const observer = new ResizeObserver(([entry]) => {
      measure(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, width]
}
