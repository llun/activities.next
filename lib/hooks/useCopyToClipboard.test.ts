/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react'

import { useCopyToClipboard } from './useCopyToClipboard'

const setClipboard = (writeText: ReturnType<typeof vi.fn> | undefined) => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: writeText ? { writeText } : undefined
  })
}

beforeEach(() => {
  // Default the legacy fallback to "unavailable" so tests that exercise the
  // Clipboard API path don't accidentally succeed via execCommand.
  document.execCommand = vi.fn(() => false)
})

afterEach(() => {
  vi.useRealTimers()
  setClipboard(undefined)
})

describe('useCopyToClipboard', () => {
  it('writes the text and flips copied true → false after the reset delay', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard(writeText)

    const { result } = renderHook(() => useCopyToClipboard(1000))
    expect(result.current.copied).toBe(false)

    await act(async () => {
      await result.current.copy('hello')
    })
    expect(writeText).toHaveBeenCalledWith('hello')
    expect(result.current.copied).toBe(true)

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.copied).toBe(false)
  })

  it('falls back to execCommand when navigator.clipboard is unavailable', async () => {
    setClipboard(undefined)
    const execCommand = vi.fn(() => true)
    document.execCommand = execCommand

    const { result } = renderHook(() => useCopyToClipboard())
    await act(async () => {
      await result.current.copy('hello')
    })
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(result.current.copied).toBe(true)
  })

  it('stays uncopied when neither clipboard API nor execCommand works', async () => {
    setClipboard(undefined)
    document.execCommand = vi.fn(() => false)
    const { result } = renderHook(() => useCopyToClipboard())
    await act(async () => {
      await result.current.copy('hello')
    })
    expect(result.current.copied).toBe(false)
  })

  it('clears the pending reset timer on unmount', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard(writeText)
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')

    const { result, unmount } = renderHook(() => useCopyToClipboard())
    await act(async () => {
      await result.current.copy('hello')
    })
    unmount()
    // The unmount cleanup clears the outstanding reset timer.
    expect(clearSpy).toHaveBeenCalled()
  })

  it('does not flip copied when it unmounts while the write is in flight', async () => {
    let resolveWrite: (() => void) | undefined
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve
        })
    )
    setClipboard(writeText)

    const { result, unmount } = renderHook(() => useCopyToClipboard())
    let copyPromise: Promise<void> | undefined
    act(() => {
      copyPromise = result.current.copy('hello')
    })
    // Unmount before the clipboard write resolves, then let it resolve.
    unmount()
    await act(async () => {
      resolveWrite?.()
      await copyPromise
    })
    // The guard skips setCopied after unmount — no act warning, no late update.
    expect(result.current.copied).toBe(false)
  })

  it('removes the temp textarea even if execCommand throws', async () => {
    setClipboard(undefined)
    document.execCommand = vi.fn(() => {
      throw new Error('boom')
    })
    const { result } = renderHook(() => useCopyToClipboard())
    await act(async () => {
      await result.current.copy('hello')
    })
    expect(result.current.copied).toBe(false)
    // The finally block must have removed the temporary node from the DOM.
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('stays uncopied when the clipboard write rejects and execCommand fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    setClipboard(writeText)
    document.execCommand = vi.fn(() => false)
    const { result } = renderHook(() => useCopyToClipboard())
    await act(async () => {
      await result.current.copy('hello')
    })
    await waitFor(() => expect(result.current.copied).toBe(false))
  })
})
