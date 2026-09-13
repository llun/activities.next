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
})
