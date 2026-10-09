/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'

import { ScrollToTopButton } from './scroll-to-top-button'

describe('ScrollToTopButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    // Reset scroll position
    Object.defineProperty(window, 'scrollY', {
      writable: true,
      configurable: true,
      value: 0
    })

    // Mock window.scrollTo
    window.scrollTo = vi.fn()
  })

  afterEach(() => {
    act(() => {
      vi.runOnlyPendingTimers()
    })
    vi.useRealTimers()
  })

  it.each([
    { scrollY: 100, isLoadMoreVisible: undefined, shown: false },
    { scrollY: 200, isLoadMoreVisible: undefined, shown: false },
    { scrollY: 400, isLoadMoreVisible: true, shown: false },
    { scrollY: 400, isLoadMoreVisible: false, shown: true },
    { scrollY: 500, isLoadMoreVisible: undefined, shown: true }
  ])(
    'is shown on mount: $shown at scrollY $scrollY with isLoadMoreVisible $isLoadMoreVisible',
    ({ scrollY, isLoadMoreVisible, shown }) => {
      Object.defineProperty(window, 'scrollY', { value: scrollY })
      render(<ScrollToTopButton isLoadMoreVisible={isLoadMoreVisible} />)

      const button = screen.queryByRole('button', { name: 'Scroll to top' })
      if (shown) {
        expect(button).toBeInTheDocument()
        expect(button).not.toBeDisabled()
      } else {
        expect(button).not.toBeInTheDocument()
      }
    }
  )

  it('hides while load more is visible and shows again once it is hidden', () => {
    Object.defineProperty(window, 'scrollY', { value: 400 })
    const { rerender } = render(<ScrollToTopButton isLoadMoreVisible={false} />)
    expect(
      screen.getByRole('button', { name: 'Scroll to top' })
    ).toBeInTheDocument()

    rerender(<ScrollToTopButton isLoadMoreVisible={true} />)
    expect(
      screen.queryByRole('button', { name: 'Scroll to top' })
    ).not.toBeInTheDocument()

    rerender(<ScrollToTopButton isLoadMoreVisible={false} />)
    expect(
      screen.getByRole('button', { name: 'Scroll to top' })
    ).toBeInTheDocument()
  })

  it('should show button after scrolling past threshold', async () => {
    Object.defineProperty(window, 'scrollY', { value: 0 })
    render(<ScrollToTopButton />)

    expect(
      screen.queryByRole('button', { name: 'Scroll to top' })
    ).not.toBeInTheDocument()

    // Simulate scrolling past threshold
    Object.defineProperty(window, 'scrollY', { value: 350 })
    fireEvent.scroll(window)

    // Fast-forward throttle timeout
    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    const button = screen.getByRole('button', { name: 'Scroll to top' })
    expect(button).toBeInTheDocument()
    expect(button).not.toBeDisabled()
  })

  it('should hide button after scrolling back above threshold', async () => {
    Object.defineProperty(window, 'scrollY', { value: 400 })
    render(<ScrollToTopButton />)

    expect(
      screen.getByRole('button', { name: 'Scroll to top' })
    ).toBeInTheDocument()

    // Simulate scrolling back to top
    Object.defineProperty(window, 'scrollY', { value: 100 })
    fireEvent.scroll(window)

    // Fast-forward throttle timeout
    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    expect(
      screen.queryByRole('button', { name: 'Scroll to top' })
    ).not.toBeInTheDocument()
  })

  it('should call window.scrollTo with smooth behavior when clicked', () => {
    Object.defineProperty(window, 'scrollY', { value: 400 })
    render(<ScrollToTopButton />)

    const button = screen.getByRole('button', { name: 'Scroll to top' })
    fireEvent.click(button)

    expect(window.scrollTo).toHaveBeenCalledWith({
      top: 0,
      behavior: 'smooth'
    })
  })

  it('should throttle scroll events to avoid excessive updates', async () => {
    Object.defineProperty(window, 'scrollY', { value: 0 })
    render(<ScrollToTopButton />)

    // Fire multiple scroll events quickly
    Object.defineProperty(window, 'scrollY', { value: 400 })
    fireEvent.scroll(window)
    fireEvent.scroll(window)
    fireEvent.scroll(window)

    // Only the first event should trigger an update after throttle timeout
    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    const button = screen.getByRole('button', { name: 'Scroll to top' })
    expect(button).toBeInTheDocument()
    expect(button).not.toBeDisabled()

    // Subsequent scrolls should be throttled
    Object.defineProperty(window, 'scrollY', { value: 200 })
    fireEvent.scroll(window)

    // No immediate change (throttled)
    expect(button).toBeInTheDocument()

    // After throttle timeout, should update
    await act(async () => {
      vi.advanceTimersByTime(100)
    })
    expect(
      screen.queryByRole('button', { name: 'Scroll to top' })
    ).not.toBeInTheDocument()
  })

  it('should clean up event listener and timeout on unmount', () => {
    Object.defineProperty(window, 'scrollY', { value: 0 })
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

    const { unmount } = render(<ScrollToTopButton />)

    // Trigger a scroll to set a timeout
    Object.defineProperty(window, 'scrollY', { value: 400 })
    fireEvent.scroll(window)

    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'scroll',
      expect.any(Function)
    )

    // Advance timers to ensure no errors after unmount
    vi.advanceTimersByTime(100)

    removeEventListenerSpy.mockRestore()
  })
})
