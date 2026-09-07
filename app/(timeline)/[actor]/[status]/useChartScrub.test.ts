/**
 * @vitest-environment jsdom
 */
import { renderHook } from '@testing-library/react'
import type { MouseEvent, TouchEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useChartScrub } from './useChartScrub'

describe('useChartScrub', () => {
  const defaultOptions = {
    values: [10, 20, 30, 40, 50],
    width: 400,
    height: 200,
    minValue: 10,
    maxValue: 50,
    durationSeconds: 1000,
    highlightedElapsedSeconds: null,
    onHighlightElapsedSeconds: vi.fn()
  }

  const createMockSvg = (left = 100, width = 400) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.getBoundingClientRect = () =>
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
    return svg
  }

  it('determines canScrub based on duration, values length, and callback', () => {
    const { result: activeResult } = renderHook(() =>
      useChartScrub(defaultOptions)
    )
    expect(activeResult.current.canScrub).toBe(true)
    expect(activeResult.current.plotClassName).toBe(
      'cursor-crosshair touch-pan-y touch-pinch-zoom'
    )

    const { result: noCallbackResult } = renderHook(() =>
      useChartScrub({
        ...defaultOptions,
        onHighlightElapsedSeconds: undefined
      })
    )
    expect(noCallbackResult.current.canScrub).toBe(false)
    expect(noCallbackResult.current.plotClassName).toBeUndefined()

    const { result: zeroDurationResult } = renderHook(() =>
      useChartScrub({
        ...defaultOptions,
        durationSeconds: 0
      })
    )
    expect(zeroDurationResult.current.canScrub).toBe(false)

    const { result: emptyValuesResult } = renderHook(() =>
      useChartScrub({
        ...defaultOptions,
        values: []
      })
    )
    expect(emptyValuesResult.current.canScrub).toBe(false)
  })

  it('calculates highlight coordinates when highlightedElapsedSeconds is provided', () => {
    // 500s of 1000s duration on 5 values ([10, 20, 30, 40, 50]) -> ratio 0.5 -> sample index 2 (value 30)
    // x: (2 / 4) * 400 = 200
    // y: 200 - ((30 - 10) / (50 - 10)) * 200 = 200 - (0.5 * 200) = 100
    const { result } = renderHook(() =>
      useChartScrub({
        ...defaultOptions,
        highlightedElapsedSeconds: 500
      })
    )

    expect(result.current.highlight).toEqual({
      value: 30,
      x: 200,
      y: 100
    })
  })

  it('returns null highlight when highlightedElapsedSeconds is null or out of range', () => {
    const { result: nullResult } = renderHook(() =>
      useChartScrub({
        ...defaultOptions,
        highlightedElapsedSeconds: null
      })
    )
    expect(nullResult.current.highlight).toBeNull()
  })

  it('handles mouseMove by calculating elapsed time from viewport clientX', () => {
    const onHighlight = vi.fn()
    const { result } = renderHook(() =>
      useChartScrub({
        ...defaultOptions,
        onHighlightElapsedSeconds: onHighlight
      })
    )

    const svg = createMockSvg(100, 400)
    const event = {
      clientX: 200, // (200 - 100) / 400 = 0.25 -> 250s
      currentTarget: svg
    } as unknown as MouseEvent<SVGSVGElement>

    result.current.plotHandlers.onMouseMove(event)
    expect(onHighlight).toHaveBeenCalledWith(250)
  })

  it('clamps mouseMove scrub ratio between 0 and 1', () => {
    const onHighlight = vi.fn()
    const { result } = renderHook(() =>
      useChartScrub({
        ...defaultOptions,
        onHighlightElapsedSeconds: onHighlight
      })
    )

    const svg = createMockSvg(100, 400)

    // Far to the left of the SVG
    result.current.plotHandlers.onMouseMove({
      clientX: 50,
      currentTarget: svg
    } as unknown as MouseEvent<SVGSVGElement>)
    expect(onHighlight).toHaveBeenCalledWith(0)

    // Far to the right of the SVG
    result.current.plotHandlers.onMouseMove({
      clientX: 600,
      currentTarget: svg
    } as unknown as MouseEvent<SVGSVGElement>)
    expect(onHighlight).toHaveBeenCalledWith(1000)
  })

  it('clears scrub on mouseLeave', () => {
    const onHighlight = vi.fn()
    const { result } = renderHook(() =>
      useChartScrub({
        ...defaultOptions,
        onHighlightElapsedSeconds: onHighlight
      })
    )

    result.current.plotHandlers.onMouseLeave()
    expect(onHighlight).toHaveBeenCalledWith(null)
  })

  it('handles touchStart and touchMove via touch clientX', () => {
    const onHighlight = vi.fn()
    const { result } = renderHook(() =>
      useChartScrub({
        ...defaultOptions,
        onHighlightElapsedSeconds: onHighlight
      })
    )

    const svg = createMockSvg(100, 400)

    result.current.plotHandlers.onTouchStart({
      touches: [{ clientX: 300 }] as unknown as TouchList,
      currentTarget: svg
    } as unknown as TouchEvent<SVGSVGElement>)
    // (300 - 100) / 400 = 0.5 -> 500s
    expect(onHighlight).toHaveBeenCalledWith(500)

    result.current.plotHandlers.onTouchMove({
      touches: [{ clientX: 400 }] as unknown as TouchList,
      currentTarget: svg
    } as unknown as TouchEvent<SVGSVGElement>)
    // (400 - 100) / 400 = 0.75 -> 750s
    expect(onHighlight).toHaveBeenCalledWith(750)
  })

  it('prevents default on touchEnd when cancelable to suppress compatibility mouse events', () => {
    const onHighlight = vi.fn()
    const { result } = renderHook(() =>
      useChartScrub({
        ...defaultOptions,
        onHighlightElapsedSeconds: onHighlight
      })
    )

    const preventDefault = vi.fn()
    result.current.plotHandlers.onTouchEnd({
      cancelable: true,
      preventDefault
    } as unknown as TouchEvent<SVGSVGElement>)

    expect(preventDefault).toHaveBeenCalled()
    expect(onHighlight).toHaveBeenCalledWith(null)
  })

  it('does not call preventDefault on touchEnd when cancelable is false', () => {
    const onHighlight = vi.fn()
    const { result } = renderHook(() =>
      useChartScrub({
        ...defaultOptions,
        onHighlightElapsedSeconds: onHighlight
      })
    )

    const preventDefault = vi.fn()
    result.current.plotHandlers.onTouchEnd({
      cancelable: false,
      preventDefault
    } as unknown as TouchEvent<SVGSVGElement>)

    expect(preventDefault).not.toHaveBeenCalled()
    expect(onHighlight).toHaveBeenCalledWith(null)
  })

  it('clears scrub on touchCancel', () => {
    const onHighlight = vi.fn()
    const { result } = renderHook(() =>
      useChartScrub({
        ...defaultOptions,
        onHighlightElapsedSeconds: onHighlight
      })
    )

    result.current.plotHandlers.onTouchCancel()
    expect(onHighlight).toHaveBeenCalledWith(null)
  })
})
