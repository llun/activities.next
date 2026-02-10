/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('should not be visible when scroll position is less than 300px', () => {
    Object.defineProperty(window, 'scrollY', { value: 200 })
    render(<ScrollToTopButton />)

    const button = screen.getByLabelText('Scroll to top')
    expect(button).toHaveClass('opacity-0')
    expect(button).toHaveAttribute('aria-hidden', 'true')
    expect(button).toHaveAttribute('tabIndex', '-1')
    expect(button).toBeDisabled()
  })

  it('should be visible when scroll position is greater than 300px', () => {
    Object.defineProperty(window, 'scrollY', { value: 400 })
    render(<ScrollToTopButton />)

    const button = screen.getByRole('button', { name: 'Scroll to top' })
    expect(button).toHaveClass('opacity-100')
    expect(button).toHaveAttribute('aria-hidden', 'false')
    expect(button).toHaveAttribute('tabIndex', '0')
    expect(button).not.toBeDisabled()
  })

  it('should show button after scrolling past threshold', async () => {
    Object.defineProperty(window, 'scrollY', { value: 0 })
    render(<ScrollToTopButton />)

    const button = screen.getByLabelText('Scroll to top')
    expect(button).toHaveClass('opacity-0')

    // Simulate scrolling past threshold
    Object.defineProperty(window, 'scrollY', { value: 350 })
    fireEvent.scroll(window)

    // Fast-forward throttle timeout
    await waitFor(() => {
      jest.advanceTimersByTime(100)
      expect(button).toHaveClass('opacity-100')
      expect(button).toHaveAttribute('aria-hidden', 'false')
      expect(button).not.toBeDisabled()
    })
  })

  it('should hide button after scrolling back above threshold', async () => {
    Object.defineProperty(window, 'scrollY', { value: 400 })
    render(<ScrollToTopButton />)

    const button = screen.getByLabelText('Scroll to top')
    expect(button).toHaveClass('opacity-100')

    // Simulate scrolling back to top
    Object.defineProperty(window, 'scrollY', { value: 100 })
    fireEvent.scroll(window)

    // Fast-forward throttle timeout
    await waitFor(() => {
      jest.advanceTimersByTime(100)
      expect(button).toHaveClass('opacity-0')
      expect(button).toHaveAttribute('aria-hidden', 'true')
      expect(button).toBeDisabled()
    })
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

    const button = screen.getByLabelText('Scroll to top')
    expect(button).toHaveClass('opacity-100')

    // Subsequent scrolls should be throttled
    Object.defineProperty(window, 'scrollY', { value: 200 })
    fireEvent.scroll(window)

    // No immediate change (throttled)
    expect(button).toHaveClass('opacity-100')

    // After throttle timeout, should update
    await act(async () => {
      jest.advanceTimersByTime(100)
    })
    expect(button).toHaveClass('opacity-0')
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

    const button = screen.getByLabelText('Scroll to top')
    expect(button).toHaveClass('opacity-100')
    expect(button).not.toBeDisabled()

    unmount()

    // Test mounting with scroll position below threshold
    Object.defineProperty(window, 'scrollY', { value: 100 })
    render(<ScrollToTopButton />)

    const button2 = screen.getByLabelText('Scroll to top')
    expect(button2).toHaveClass('opacity-0')
    expect(button2).toBeDisabled()
  })
})
