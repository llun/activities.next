/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'

import { ScrollToTopButton } from './scroll-to-top-button'

describe('ScrollToTopButton', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()

    // Reset scroll position
    Object.defineProperty(window, 'scrollY', {
      writable: true,
      configurable: true,
      value: 0
    })

    // Mock window.scrollTo
    window.scrollTo = jest.fn()
  })

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers()
    })
    jest.useRealTimers()
  })

  it('should not render button when scroll position is less than 300px', () => {
    Object.defineProperty(window, 'scrollY', { value: 200 })
    render(<ScrollToTopButton />)

    expect(
      screen.queryByRole('button', { name: 'Scroll to top' })
    ).not.toBeInTheDocument()
  })

  it('should not render button when load more is visible even if scrolled', () => {
    Object.defineProperty(window, 'scrollY', { value: 400 })
    render(<ScrollToTopButton isLoadMoreVisible={true} />)

    expect(
      screen.queryByRole('button', { name: 'Scroll to top' })
    ).not.toBeInTheDocument()
  })

  it('should be visible when scroll position is greater than 300px and load more is not visible', () => {
    Object.defineProperty(window, 'scrollY', { value: 400 })
    render(<ScrollToTopButton isLoadMoreVisible={false} />)

    const button = screen.getByRole('button', { name: 'Scroll to top' })
    expect(button).toHaveClass('bg-white')
    expect(button).toHaveClass('animate-in')
    expect(button).toHaveTextContent('Scroll to top')
    expect(button).not.toBeDisabled()
  })

  it('should hide button when load more becomes visible', async () => {
    Object.defineProperty(window, 'scrollY', { value: 400 })
    const { rerender } = render(<ScrollToTopButton isLoadMoreVisible={false} />)

    expect(
      screen.getByRole('button', { name: 'Scroll to top' })
    ).toBeInTheDocument()

    // Load more becomes visible
    rerender(<ScrollToTopButton isLoadMoreVisible={true} />)

    expect(
      screen.queryByRole('button', { name: 'Scroll to top' })
    ).not.toBeInTheDocument()
  })

  it('should show button again when load more becomes hidden', async () => {
    Object.defineProperty(window, 'scrollY', { value: 400 })
    const { rerender } = render(<ScrollToTopButton isLoadMoreVisible={true} />)

    expect(
      screen.queryByRole('button', { name: 'Scroll to top' })
    ).not.toBeInTheDocument()

    // Load more becomes hidden
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
      jest.advanceTimersByTime(100)
    })

    expect(screen.getByRole('button', { name: 'Scroll to top' })).toHaveClass(
      'bg-white'
    )
  })

  it('should hide button after scrolling back above threshold', async () => {
    Object.defineProperty(window, 'scrollY', { value: 400 })
    render(<ScrollToTopButton />)

    expect(screen.getByRole('button', { name: 'Scroll to top' })).toHaveClass(
      'bg-white'
    )

    // Simulate scrolling back to top
    Object.defineProperty(window, 'scrollY', { value: 100 })
    fireEvent.scroll(window)

    // Fast-forward throttle timeout
    await act(async () => {
      jest.advanceTimersByTime(100)
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
      jest.advanceTimersByTime(100)
    })

    const button = screen.getByRole('button', { name: 'Scroll to top' })
    expect(button).toHaveClass('bg-white')

    // Subsequent scrolls should be throttled
    Object.defineProperty(window, 'scrollY', { value: 200 })
    fireEvent.scroll(window)

    // No immediate change (throttled)
    expect(button).toHaveClass('bg-white')

    // After throttle timeout, should update
    await act(async () => {
      jest.advanceTimersByTime(100)
    })
    expect(
      screen.queryByRole('button', { name: 'Scroll to top' })
    ).not.toBeInTheDocument()
  })

  it('should clean up event listener and timeout on unmount', () => {
    Object.defineProperty(window, 'scrollY', { value: 0 })
    const removeEventListenerSpy = jest.spyOn(window, 'removeEventListener')

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
    jest.advanceTimersByTime(100)

    removeEventListenerSpy.mockRestore()
  })

  it('should set initial visibility correctly based on scroll position on mount', () => {
    // Test mounting with scroll position above threshold
    Object.defineProperty(window, 'scrollY', { value: 500 })
    const { unmount } = render(<ScrollToTopButton />)

    const button = screen.getByRole('button', { name: 'Scroll to top' })
    expect(button).toHaveClass('bg-white')
    expect(button).not.toBeDisabled()

    unmount()

    // Test mounting with scroll position below threshold
    Object.defineProperty(window, 'scrollY', { value: 100 })
    render(<ScrollToTopButton />)

    expect(
      screen.queryByRole('button', { name: 'Scroll to top' })
    ).not.toBeInTheDocument()
  })
})
