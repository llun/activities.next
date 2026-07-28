'use client'

import { RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Below this the action row can no longer carry every control at a comfortable
 * hit size, so bookmark and react move into the ⋯ menu.
 */
export const COMPACT_ACTION_BAR_WIDTH = 400

// The measurement has to land before the browser paints, or the bar renders
// wide for a frame and then reflows. `useLayoutEffect` warns when React renders
// on the server, where there is nothing to measure anyway.
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * Measures the action row's own container rather than the viewport. A post is
 * not always as wide as the window — it can sit in a narrow column, a modal or
 * an embed — and a viewport breakpoint would collapse the wrong ones.
 *
 * Reports "wide" wherever `ResizeObserver` is missing (server render, jsdom):
 * the full row is the honest default, and the first client layout corrects it.
 */
export const useCompactActionBar = (
  threshold: number = COMPACT_ACTION_BAR_WIDTH
): [RefObject<HTMLDivElement | null>, boolean] => {
  const ref = useRef<HTMLDivElement>(null)
  const [isCompact, setIsCompact] = useState(false)

  useIsomorphicLayoutEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return

    // A zero width means the row was never laid out — a `display: none`
    // ancestor, a detached subtree, jsdom — not that it is narrow. Keeping the
    // last known answer there is what stops every such environment collapsing
    // the row; the observer delivers a real width as soon as there is one.
    const measure = (width: number) => {
      if (width === 0) return
      setIsCompact(width < threshold)
    }

    // Measure here rather than leaving it to the observer's first delivery.
    // That delivery lands in the browser's rendering step and the state update
    // it schedules is not discrete, so React runs it after the frame has
    // painted — which on every narrow post flashes the full row and then drops
    // two buttons out of it. A layout-effect `setState` is flushed before paint.
    measure(element.getBoundingClientRect().width)

    const observer = new ResizeObserver(([entry]) => {
      measure(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [threshold])

  return [ref, isCompact]
}
