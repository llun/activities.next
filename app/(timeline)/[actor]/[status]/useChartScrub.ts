import { type MouseEvent, type TouchEvent } from 'react'

import {
  type ChartHighlight,
  clampNumber,
  computeChartHighlight,
  computeHighlightedIndex
} from './fitnessChartData'

export interface ChartScrubOptions {
  values: number[]
  width: number
  height: number
  minValue: number
  maxValue: number
  durationSeconds?: number
  highlightedElapsedSeconds?: number | null
  onHighlightElapsedSeconds?: (elapsedSeconds: number | null) => void
}

export interface ChartScrubResult {
  canScrub: boolean
  highlight: ChartHighlight | null
  plotClassName?: string
  plotHandlers: {
    onMouseMove: (event: MouseEvent<SVGSVGElement>) => void
    onMouseLeave: () => void
    onTouchStart: (event: TouchEvent<SVGSVGElement>) => void
    onTouchMove: (event: TouchEvent<SVGSVGElement>) => void
    onTouchEnd: (event: TouchEvent<SVGSVGElement>) => void
    onTouchCancel: () => void
  }
}

// Everything a chart needs to follow the pointer: whether it can, where the
// highlighted sample sits in plot coordinates, and the DOM handlers that turn a
// pointer or a finger into an elapsed time.
//
// This lives in one hook because two visually different charts now share the
// behaviour — the Analysis stack's line panels and the Overview's filled
// elevation profile. Keeping the geometry beside the handlers is what stops the
// dot from drifting off the line: both read the same `getChartXPosition` /
// `getChartYPosition` projection the path was drawn with.
export const useChartScrub = ({
  values,
  width,
  height,
  minValue,
  maxValue,
  durationSeconds,
  highlightedElapsedSeconds = null,
  onHighlightElapsedSeconds
}: ChartScrubOptions): ChartScrubResult => {
  const canScrub =
    typeof onHighlightElapsedSeconds === 'function' &&
    typeof durationSeconds === 'number' &&
    durationSeconds > 0 &&
    values.length > 0

  // One nullable object rather than three parallel nullable fields plus an
  // `isHighlighted` boolean: a boolean beside them narrows nothing, so every
  // consumer had to re-assert that x, y and value were numbers before it could
  // pass them anywhere typed.
  const highlightedIndex = canScrub
    ? computeHighlightedIndex(
        highlightedElapsedSeconds,
        durationSeconds,
        values.length
      )
    : null
  const highlight = computeChartHighlight(
    values,
    highlightedIndex,
    width,
    height,
    minValue,
    maxValue
  )

  // One scrub for pointer and touch alike: both report a viewport x, and the
  // instant it lands on is the same either way.
  const scrubToClientX = (clientX: number | undefined, plot: SVGSVGElement) => {
    if (!canScrub || !onHighlightElapsedSeconds) return
    if (typeof clientX !== 'number') return
    const bounds = plot.getBoundingClientRect()
    const ratio = clampNumber(
      (clientX - bounds.left) / Math.max(bounds.width, 1),
      0,
      1
    )
    onHighlightElapsedSeconds(ratio * durationSeconds)
  }

  const clearScrub = () => {
    if (!canScrub || !onHighlightElapsedSeconds) return
    onHighlightElapsedSeconds(null)
  }

  const plotHandlers = {
    onMouseMove: (event: MouseEvent<SVGSVGElement>) => {
      scrubToClientX(event.clientX, event.currentTarget)
    },
    onMouseLeave: clearScrub,
    onTouchStart: (event: TouchEvent<SVGSVGElement>) => {
      scrubToClientX(event.touches[0]?.clientX, event.currentTarget)
    },
    onTouchMove: (event: TouchEvent<SVGSVGElement>) => {
      scrubToClientX(event.touches[0]?.clientX, event.currentTarget)
    },
    onTouchEnd: (event: TouchEvent<SVGSVGElement>) => {
      // A tap is followed by compatibility `mousemove`/`mousedown`/…
      // at the same point, and that `mousemove` would re-enter the scrub
      // the moment this clears it — leaving the readout stuck on, because
      // no `mouseleave` follows a touch. Preventing the default suppresses
      // that whole compat sequence; the chart has no click behaviour to
      // lose, and a drag never gets here stuck anyway because movement
      // past the tap slop suppresses the compat events on its own.
      // Guarded on `cancelable`: once a scroll is underway Chrome keeps
      // dispatching `touchend` with `cancelable: false` rather than
      // switching to `touchcancel`, and calling this on one of those is a
      // no-op that logs a warning on every vertical swipe that started on
      // a chart — which is most of them, under four stacked full-width
      // charts.
      if (event.cancelable) event.preventDefault()
      clearScrub()
    },
    onTouchCancel: clearScrub
  }

  // A vertical swipe still scrolls the page and a pinch still zooms; only the
  // horizontal drag is claimed, for scrubbing. Both of the other two have to be
  // named explicitly — `touch-pan-y` on its own compiles to exactly
  // `touch-action: pan-y`, which drops pinch-zoom, and blocking magnification
  // over a stack of charts takes it away in the one place a low-vision reader
  // most wants it.
  const plotClassName = canScrub
    ? 'cursor-crosshair touch-pan-y touch-pinch-zoom'
    : undefined

  return {
    canScrub,
    highlight,
    plotClassName,
    plotHandlers
  }
}
