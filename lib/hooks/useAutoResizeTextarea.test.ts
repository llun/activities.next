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

  it('observes width changes via ResizeObserver and adjusts height', () => {
    let resizeCallback: (
      entries: Array<{ contentRect: { width: number } }>
    ) => void = () => {}
    const disconnectSpy = vi.fn()
    const observeSpy = vi.fn()

    class MockResizeObserver {
      constructor(cb: any) {
        resizeCallback = cb
      }
      observe = observeSpy
      unobserve = vi.fn()
      disconnect = disconnectSpy
    }

    const originalResizeObserver = globalThis.ResizeObserver
    globalThis.ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver

    try {
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

      const { unmount } = renderHook(() => useAutoResizeTextarea(ref, 'text'))

      expect(observeSpy).toHaveBeenCalledWith(textarea)
      expect(textarea.style.height).toBe('100px')

      // Width changed significantly (e.g. 300 -> 200 causing more line wrapping)
      Object.defineProperty(textarea, 'scrollHeight', {
        configurable: true,
        value: 150
      })

      act(() => {
        resizeCallback([{ contentRect: { width: 200 } }])
      })

      expect(textarea.style.height).toBe('150px')

      // Height changed but width difference < 0.5 (e.g. 200 -> 200.2)
      Object.defineProperty(textarea, 'scrollHeight', {
        configurable: true,
        value: 200
      })

      act(() => {
        resizeCallback([{ contentRect: { width: 200.2 } }])
      })

      // Should not have updated height because width didn't change >= 0.5
      expect(textarea.style.height).toBe('150px')

      unmount()
      expect(disconnectSpy).toHaveBeenCalled()
    } finally {
      globalThis.ResizeObserver = originalResizeObserver
    }
  })

  it('adjusts height on window and visualViewport resize and cleans up listeners', () => {
    const viewportAddSpy = vi.fn()
    const viewportRemoveSpy = vi.fn()
    const mockViewport = {
      addEventListener: viewportAddSpy,
      removeEventListener: viewportRemoveSpy
    }

    const originalVisualViewport = window.visualViewport
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: mockViewport
    })

    try {
      Object.defineProperty(textarea, 'scrollHeight', {
        configurable: true,
        value: 100
      })

      const ref = createRef<HTMLTextAreaElement>()
      ref.current = textarea

      const { unmount } = renderHook(() => useAutoResizeTextarea(ref, 'text'))

      expect(viewportAddSpy).toHaveBeenCalledWith(
        'resize',
        expect.any(Function)
      )

      // Trigger window resize
      Object.defineProperty(textarea, 'scrollHeight', {
        configurable: true,
        value: 130
      })

      act(() => {
        window.dispatchEvent(new Event('resize'))
      })

      expect(textarea.style.height).toBe('130px')

      // Trigger visualViewport resize callback
      const viewportResizeHandler = viewportAddSpy.mock.calls[0][1]
      Object.defineProperty(textarea, 'scrollHeight', {
        configurable: true,
        value: 160
      })

      act(() => {
        viewportResizeHandler()
      })

      expect(textarea.style.height).toBe('160px')

      unmount()
      expect(viewportRemoveSpy).toHaveBeenCalledWith(
        'resize',
        expect.any(Function)
      )
    } finally {
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: originalVisualViewport
      })
    }
  })
})
