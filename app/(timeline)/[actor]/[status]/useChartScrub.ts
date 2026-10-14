import { type PointerEvent } from 'react'

import { clampNumber } from './fitnessChartData'

export interface ChartScrubOptions {
  durationSeconds?: number
  onHighlightElapsedSeconds?: (elapsedSeconds: number | null) => void
}

export interface ChartScrubResult {
  canScrub: boolean
  plotClassName?: string
  plotHandlers: {
    onPointerDown: (event: PointerEvent<Element>) => void
    onPointerMove: (event: PointerEvent<Element>) => void
    onPointerLeave: () => void
    onPointerCancel: () => void
  }
}

// Turns a pointer over a plot into an elapsed time: the x of the pointer as a
// share of the plot's width, times the activity's duration. Every chart of the
// activity page scrubs through this one hook, so a hover on any of them moves
// the same instant on the map and on every other chart.
//
// Pointer events, not mouse and touch ones: a finger and a mouse both report a
// viewport x, and a tap is not followed by compatibility mouse events that
// would re-enter the scrub after it was cleared. A finger lifting fires
// `pointerleave`, which clears the readout the way the mouse leaving does.
export const useChartScrub = ({
  durationSeconds,
  onHighlightElapsedSeconds
}: ChartScrubOptions): ChartScrubResult => {
  const canScrub =
    typeof onHighlightElapsedSeconds === 'function' &&
    typeof durationSeconds === 'number' &&
    durationSeconds > 0

  const scrubTo = (event: PointerEvent<Element>) => {
    if (!canScrub || !onHighlightElapsedSeconds) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const ratio = clampNumber(
      (event.clientX - bounds.left) / Math.max(bounds.width, 1),
      0,
      1
    )
    onHighlightElapsedSeconds(ratio * (durationSeconds as number))
  }

  const clearScrub = () => {
    if (!canScrub || !onHighlightElapsedSeconds) return
    onHighlightElapsedSeconds(null)
  }

  // A vertical swipe still scrolls the page and a pinch still zooms; only the
  // horizontal drag is claimed, for scrubbing. Both of the other two have to be
  // named explicitly — `touch-pan-y` on its own compiles to exactly
  // `touch-action: pan-y`, which drops pinch-zoom, and blocking magnification
  // over a stack of charts takes it away in the one place a low-vision reader
  // most wants it.
  return {
    canScrub,
    plotClassName: canScrub
      ? 'cursor-crosshair touch-pan-y touch-pinch-zoom'
      : undefined,
    plotHandlers: {
      onPointerDown: scrubTo,
      onPointerMove: scrubTo,
      onPointerLeave: clearScrub,
      onPointerCancel: clearScrub
    }
  }
}
