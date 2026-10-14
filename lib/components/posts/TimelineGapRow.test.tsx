/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { TimelineGapRow } from './TimelineGapRow'

describe('TimelineGapRow', () => {
  it('renders load missing posts button and triggers callback', () => {
    const onLoadGap = vi.fn()
    render(<TimelineGapRow segmentIndex={1} onLoadGap={onLoadGap} />)

    const button = screen.getByRole('button', { name: /load missing posts/i })
    expect(button).toBeInTheDocument()
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'false')

    fireEvent.click(button)
    expect(onLoadGap).toHaveBeenCalledWith(1)
  })

  it('disables button and adds spinning animation when isLoading is true', () => {
    const onLoadGap = vi.fn()
    const { container } = render(
      <TimelineGapRow segmentIndex={0} isLoading onLoadGap={onLoadGap} />
    )

    const button = screen.getByRole('button', { name: /load missing posts/i })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')

    const icon = container.querySelector('svg')
    expect(icon).toHaveClass('animate-spin')

    fireEvent.click(button)
    expect(onLoadGap).not.toHaveBeenCalled()
  })

  it('disables button when offline event fires', () => {
    const onLoadGap = vi.fn()
    render(<TimelineGapRow segmentIndex={2} onLoadGap={onLoadGap} />)

    const button = screen.getByRole('button', { name: /load missing posts/i })
    expect(button).not.toBeDisabled()

    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(button).toBeDisabled()

    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(button).not.toBeDisabled()
  })
})
