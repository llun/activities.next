/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  supportsFieldSizing,
  useAutoResizeTextarea
} from './useAutoResizeTextarea'

describe('supportsFieldSizing', () => {
  const originalCSS = globalThis.CSS

  afterEach(() => {
    globalThis.CSS = originalCSS
  })

  it('returns false when CSS or CSS.supports is undefined', () => {
    // @ts-expect-error testing missing CSS
    delete globalThis.CSS
    expect(supportsFieldSizing()).toBe(false)
  })

  it('returns true when CSS.supports reports field-sizing: content is supported', () => {
    globalThis.CSS = {
      supports: vi.fn((prop: string, value: string) => {
        return prop === 'field-sizing' && value === 'content'
      })
    } as unknown as typeof CSS
    expect(supportsFieldSizing()).toBe(true)
  })

  it('returns false when CSS.supports reports field-sizing: content is not supported', () => {
    globalThis.CSS = {
      supports: vi.fn(() => false)
    } as unknown as typeof CSS
    expect(supportsFieldSizing()).toBe(false)
  })
})

describe('useAutoResizeTextarea', () => {
  let textarea: HTMLTextAreaElement
  let originalCSS: typeof CSS

  beforeEach(() => {
    originalCSS = globalThis.CSS
    // Default: field-sizing not supported (fallback active)
    globalThis.CSS = {
      supports: vi.fn(() => false)
    } as unknown as typeof CSS

    textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
  })

  afterEach(() => {
    globalThis.CSS = originalCSS
    textarea.remove()
  })

  it('does nothing when field-sizing: content is natively supported', () => {
    globalThis.CSS = {
      supports: vi.fn((prop: string, value: string) => {
        return prop === 'field-sizing' && value === 'content'
      })
    } as unknown as typeof CSS

    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      value: 150
    })

    const ref = createRef<HTMLTextAreaElement>()
    ref.current = textarea

    renderHook(({ value }) => useAutoResizeTextarea(ref, value), {
      initialProps: { value: 'initial' }
    })

    expect(textarea.style.height).toBe('')
  })

  it('measures and assigns style.height from scrollHeight on mount and value changes', () => {
    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      value: 120
    })

    const ref = createRef<HTMLTextAreaElement>()
    ref.current = textarea

    const { rerender } = renderHook(
      ({ value }) => useAutoResizeTextarea(ref, value),
      {
        initialProps: { value: 'Line 1\nLine 2' }
      }
    )

    expect(textarea.style.height).toBe('120px')

    // Simulate expanded content
    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      value: 220
    })

    act(() => {
      rerender({ value: 'Line 1\nLine 2\nLine 3\nLine 4' })
    })

    expect(textarea.style.height).toBe('220px')

    // Simulate shrinking content
    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      value: 72
    })

    act(() => {
      rerender({ value: 'Line 1' })
    })

    expect(textarea.style.height).toBe('72px')
  })

  describe('borders', () => {
    const lay = (
      el: HTMLTextAreaElement,
      layout: {
        scrollHeight: number
        offsetHeight: number
        clientHeight: number
      }
    ) => {
      for (const [property, value] of Object.entries(layout)) {
        Object.defineProperty(el, property, { configurable: true, value })
      }
    }

    it('adds the borders to the measured height of a bordered textarea', () => {
      // A `border-box` textarea with a 1px border: scrollHeight is the padding
      // box, so the height must cover the 2px of border as well or the last line
      // scrolls out of view.
      lay(textarea, { scrollHeight: 80, offsetHeight: 84, clientHeight: 82 })

      const ref = createRef<HTMLTextAreaElement>()
      ref.current = textarea
      renderHook(() => useAutoResizeTextarea(ref, 'text'))

      expect(textarea.style.height).toBe('82px')
    })

    it('keeps adding them as the content grows and shrinks', () => {
      lay(textarea, { scrollHeight: 80, offsetHeight: 84, clientHeight: 82 })

      const ref = createRef<HTMLTextAreaElement>()
      ref.current = textarea
      const { rerender } = renderHook(
        ({ value }) => useAutoResizeTextarea(ref, value),
        { initialProps: { value: 'one' } }
      )
      expect(textarea.style.height).toBe('82px')

      lay(textarea, { scrollHeight: 200, offsetHeight: 204, clientHeight: 202 })
      act(() => {
        rerender({ value: 'one\ntwo\nthree\nfour\nfive' })
      })
      expect(textarea.style.height).toBe('202px')

      lay(textarea, { scrollHeight: 50, offsetHeight: 54, clientHeight: 52 })
      act(() => {
        textarea.dispatchEvent(new Event('input'))
      })
      expect(textarea.style.height).toBe('52px')
    })

    it('adds nothing for a borderless textarea, like the composers', () => {
      // The composers have no border, so offsetHeight equals clientHeight and the
      // height stays exactly the scrollHeight they always got.
      lay(textarea, { scrollHeight: 120, offsetHeight: 120, clientHeight: 120 })

      const ref = createRef<HTMLTextAreaElement>()
      ref.current = textarea
      renderHook(() => useAutoResizeTextarea(ref, 'text'))

      expect(textarea.style.height).toBe('120px')
    })

    it('keeps the rows height while nothing is laid out, instead of collapsing to 0px', () => {
      lay(textarea, { scrollHeight: 0, offsetHeight: 2, clientHeight: 0 })

      const ref = createRef<HTMLTextAreaElement>()
      ref.current = textarea
      renderHook(() => useAutoResizeTextarea(ref, 'text'))

      // Not `2px`: borders alone are not a measurement.
      expect(textarea.style.height).toBe('auto')
    })
  })

  it('preserves scrollTop during height adjustments', () => {
    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      value: 350
    })
    textarea.scrollTop = 140

    const ref = createRef<HTMLTextAreaElement>()
    ref.current = textarea

    const { rerender } = renderHook(
      ({ value }) => useAutoResizeTextarea(ref, value),
      {
        initialProps: { value: 'Many lines of text...' }
      }
    )

    expect(textarea.scrollTop).toBe(140)

    act(() => {
      rerender({ value: 'Many lines of text... updated' })
    })

    expect(textarea.scrollTop).toBe(140)
  })

  it('adjusts height on native input events', () => {
    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      value: 100
    })

    const ref = createRef<HTMLTextAreaElement>()
    ref.current = textarea

    renderHook(() => useAutoResizeTextarea(ref, 'text'))

    expect(textarea.style.height).toBe('100px')

    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      value: 180
    })

    act(() => {
      textarea.dispatchEvent(new Event('input'))
    })

    expect(textarea.style.height).toBe('180px')
  })

  it('cleans up event listeners and observer on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(textarea, 'removeEventListener')
    const windowRemoveSpy = vi.spyOn(window, 'removeEventListener')

    const ref = createRef<HTMLTextAreaElement>()
    ref.current = textarea

    const { unmount } = renderHook(() => useAutoResizeTextarea(ref, 'hello'))

    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'input',
      expect.any(Function)
    )
    expect(windowRemoveSpy).toHaveBeenCalledWith('resize', expect.any(Function))
  })

  describe('ResizeObserver', () => {
    let resizeCallback: (
      entries: Array<{ contentRect: { width: number } }>
    ) => void
    let disconnectSpy: ReturnType<typeof vi.fn>
    let observeSpy: ReturnType<typeof vi.fn>
    let originalResizeObserver: typeof ResizeObserver
    let unmount: () => void

    beforeEach(() => {
      resizeCallback = () => {}
      disconnectSpy = vi.fn()
      observeSpy = vi.fn()

      class MockResizeObserver {
        constructor(cb: any) {
          resizeCallback = cb
        }
        observe = observeSpy
        unobserve = vi.fn()
        disconnect = disconnectSpy
      }

      originalResizeObserver = globalThis.ResizeObserver
      globalThis.ResizeObserver =
        MockResizeObserver as unknown as typeof ResizeObserver

      vi.spyOn(textarea, 'getBoundingClientRect').mockReturnValue({
        width: 300,
        height: 72,
        top: 0,
        left: 0,
        bottom: 72,
        right: 300,
        x: 0,
        y: 0,
        toJSON: () => {}
      })

      Object.defineProperty(textarea, 'scrollHeight', {
        configurable: true,
        value: 100
      })

      const ref = createRef<HTMLTextAreaElement>()
      ref.current = textarea

      ;({ unmount } = renderHook(() => useAutoResizeTextarea(ref, 'text')))
    })

    afterEach(() => {
      globalThis.ResizeObserver = originalResizeObserver
    })

    it('observes the textarea and measures its height on mount', () => {
      expect(observeSpy).toHaveBeenCalledWith(textarea)
      expect(textarea.style.height).toBe('100px')
    })

    it('adjusts the height when the width changes significantly', () => {
      // Width changed significantly (e.g. 300 -> 200 causing more line wrapping)
      Object.defineProperty(textarea, 'scrollHeight', {
        configurable: true,
        value: 150
      })

      act(() => {
        resizeCallback([{ contentRect: { width: 200 } }])
      })

      expect(textarea.style.height).toBe('150px')
    })

    it('ignores a width change under 0.5px', () => {
      // Height changed but width difference < 0.5 (e.g. 300 -> 300.2)
      Object.defineProperty(textarea, 'scrollHeight', {
        configurable: true,
        value: 200
      })

      act(() => {
        resizeCallback([{ contentRect: { width: 300.2 } }])
      })

      // Should not have updated height because width didn't change >= 0.5
      expect(textarea.style.height).toBe('100px')
    })

    it('disconnects the observer on unmount', () => {
      unmount()
      expect(disconnectSpy).toHaveBeenCalled()
    })
  })

  describe('window and visualViewport resize', () => {
    let viewportAddSpy: ReturnType<typeof vi.fn>
    let viewportRemoveSpy: ReturnType<typeof vi.fn>
    let originalVisualViewport: VisualViewport | null
    let unmount: () => void

    beforeEach(() => {
      viewportAddSpy = vi.fn()
      viewportRemoveSpy = vi.fn()
      const mockViewport = {
        addEventListener: viewportAddSpy,
        removeEventListener: viewportRemoveSpy
      }

      originalVisualViewport = window.visualViewport
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: mockViewport
      })

      Object.defineProperty(textarea, 'scrollHeight', {
        configurable: true,
        value: 100
      })

      const ref = createRef<HTMLTextAreaElement>()
      ref.current = textarea

      ;({ unmount } = renderHook(() => useAutoResizeTextarea(ref, 'text')))
    })

    afterEach(() => {
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: originalVisualViewport
      })
    })

    it('adjusts the height on window resize', () => {
      Object.defineProperty(textarea, 'scrollHeight', {
        configurable: true,
        value: 130
      })

      act(() => {
        window.dispatchEvent(new Event('resize'))
      })

      expect(textarea.style.height).toBe('130px')
    })

    it('adjusts the height on visualViewport resize', () => {
      expect(viewportAddSpy).toHaveBeenCalledWith(
        'resize',
        expect.any(Function)
      )

      const viewportResizeHandler = viewportAddSpy.mock.calls[0][1]
      Object.defineProperty(textarea, 'scrollHeight', {
        configurable: true,
        value: 160
      })

      act(() => {
        viewportResizeHandler()
      })

      expect(textarea.style.height).toBe('160px')
    })

    it('removes both resize listeners on unmount', () => {
      const windowRemoveSpy = vi.spyOn(window, 'removeEventListener')

      unmount()

      expect(viewportRemoveSpy).toHaveBeenCalledWith(
        'resize',
        expect.any(Function)
      )
      expect(windowRemoveSpy).toHaveBeenCalledWith(
        'resize',
        expect.any(Function)
      )
    })
  })
})
