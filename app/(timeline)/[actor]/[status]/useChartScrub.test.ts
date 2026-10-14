/**
 * @vitest-environment jsdom
 */
import { renderHook } from '@testing-library/react'
import type { PointerEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useChartScrub } from './useChartScrub'

const createPlot = (left = 100, width = 400) => {
  const plot = document.createElement('div')
  plot.getBoundingClientRect = () =>
    ({
      left,
      width,
      top: 50,
      height: 200,
      right: left + width,
      bottom: 250,
      x: left,
      y: 50,
      toJSON: () => {}
    }) as DOMRect
  return plot
}

const pointerAt = (clientX: number, plot: Element) =>
  ({ clientX, currentTarget: plot }) as unknown as PointerEvent<Element>

describe('useChartScrub', () => {
  it('can scrub only with a duration and a callback', () => {
    const onHighlight = vi.fn()
    const { result } = renderHook(() =>
      useChartScrub({
        durationSeconds: 1000,
        onHighlightElapsedSeconds: onHighlight
      })
    )
    expect(result.current.canScrub).toBe(true)
    expect(result.current.plotClassName).toBe(
      'cursor-crosshair touch-pan-y touch-pinch-zoom'
    )

    const { result: noCallback } = renderHook(() =>
      useChartScrub({ durationSeconds: 1000 })
    )
    expect(noCallback.current.canScrub).toBe(false)
    expect(noCallback.current.plotClassName).toBeUndefined()

    const { result: noDuration } = renderHook(() =>
      useChartScrub({
        durationSeconds: 0,
        onHighlightElapsedSeconds: onHighlight
      })
    )
    expect(noDuration.current.canScrub).toBe(false)
  })

  it.each([
    ['the left edge', 100, 0],
    ['the middle', 300, 500],
    ['past the right edge', 900, 1000],
    ['before the left edge', 0, 0]
  ])('maps a pointer at %s to an elapsed time', (_, clientX, expected) => {
    const onHighlight = vi.fn()
    const { result } = renderHook(() =>
      useChartScrub({
        durationSeconds: 1000,
        onHighlightElapsedSeconds: onHighlight
      })
    )
    result.current.plotHandlers.onPointerMove(pointerAt(clientX, createPlot()))
    expect(onHighlight).toHaveBeenCalledWith(expected)
  })

  it('scrubs on pointer down so a tap shows a reading', () => {
    const onHighlight = vi.fn()
    const { result } = renderHook(() =>
      useChartScrub({
        durationSeconds: 600,
        onHighlightElapsedSeconds: onHighlight
      })
    )
    result.current.plotHandlers.onPointerDown(pointerAt(200, createPlot()))
    expect(onHighlight).toHaveBeenCalledWith(150)
  })

  it('clears the highlight when the pointer leaves or is cancelled', () => {
    const onHighlight = vi.fn()
    const { result } = renderHook(() =>
      useChartScrub({
        durationSeconds: 600,
        onHighlightElapsedSeconds: onHighlight
      })
    )
    result.current.plotHandlers.onPointerLeave()
    result.current.plotHandlers.onPointerCancel()
    expect(onHighlight).toHaveBeenNthCalledWith(1, null)
    expect(onHighlight).toHaveBeenNthCalledWith(2, null)
  })

  it('does nothing when it cannot scrub', () => {
    const { result } = renderHook(() => useChartScrub({ durationSeconds: 600 }))
    expect(() =>
      result.current.plotHandlers.onPointerMove(pointerAt(200, createPlot()))
    ).not.toThrow()
  })
})
