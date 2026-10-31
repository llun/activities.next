/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { preloadInlineStatusComposer } from './lazy-inline-status-composer'
import { useInlineComposer } from './useInlineComposer'

vi.mock('./lazy-inline-status-composer', () => ({
  preloadInlineStatusComposer: vi.fn()
}))

describe('useInlineComposer preload', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // jsdom has no requestIdleCallback; the hook falls back to a timeout.
    vi.stubGlobal('requestIdleCallback', undefined)
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('never preloads the composer chunk for an anonymous viewer', () => {
    renderHook(() => useInlineComposer(false))
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(preloadInlineStatusComposer).not.toHaveBeenCalled()
  })

  it('preloads the composer chunk once for a signed-in viewer', () => {
    const { rerender } = renderHook(() => useInlineComposer(true))
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    rerender()
    expect(preloadInlineStatusComposer).toHaveBeenCalledTimes(1)
  })

  it('uses idle time when the browser provides it', () => {
    const idle = vi.fn((callback: () => void) => {
      callback()
      return 1
    })
    vi.stubGlobal('requestIdleCallback', idle)
    vi.stubGlobal('cancelIdleCallback', vi.fn())
    const { unmount } = renderHook(() => useInlineComposer(true))
    unmount()
    expect(idle).toHaveBeenCalledTimes(1)
    expect(preloadInlineStatusComposer).toHaveBeenCalledTimes(1)
  })
})
