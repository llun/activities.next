/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNote } from '@/lib/components/posts/__fixtures__/timeline-context'

import { ReplyToast } from './reply-toast'

describe('ReplyToast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders "Reply posted" and "View reply"', () => {
    const mockStatus = createMockNote({ id: 'https://example.com/s/1' })
    const onDismiss = vi.fn()
    const onViewReply = vi.fn()

    render(
      <ReplyToast
        status={mockStatus}
        onDismiss={onDismiss}
        onViewReply={onViewReply}
      />
    )

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('Reply posted')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'View reply' })
    ).toBeInTheDocument()
  })

  it('calls onViewReply with status when "View reply" is clicked', () => {
    const mockStatus = createMockNote({ id: 'https://example.com/s/2' })
    const onDismiss = vi.fn()
    const onViewReply = vi.fn()

    render(
      <ReplyToast
        status={mockStatus}
        onDismiss={onDismiss}
        onViewReply={onViewReply}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'View reply' }))
    expect(onViewReply).toHaveBeenCalledTimes(1)
    expect(onViewReply).toHaveBeenCalledWith(mockStatus)
  })

  it('calls onDismiss when close button is clicked', () => {
    const mockStatus = createMockNote({ id: 'https://example.com/s/3' })
    const onDismiss = vi.fn()
    const onViewReply = vi.fn()

    render(
      <ReplyToast
        status={mockStatus}
        onDismiss={onDismiss}
        onViewReply={onViewReply}
      />
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss notification' })
    )
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('auto-dismisses after the specified duration', () => {
    const mockStatus = createMockNote({ id: 'https://example.com/s/4' })
    const onDismiss = vi.fn()
    const onViewReply = vi.fn()

    render(
      <ReplyToast
        status={mockStatus}
        onDismiss={onDismiss}
        onViewReply={onViewReply}
        duration={3000}
      />
    )

    expect(onDismiss).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
