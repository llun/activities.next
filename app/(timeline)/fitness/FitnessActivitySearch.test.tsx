/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SEARCH_DEBOUNCE_MS } from '@/lib/components/debounced-search-input'

import { FitnessActivitySearch } from './FitnessActivitySearch'

const mockReplace = vi.fn()
const mockSearchParams = { current: new URLSearchParams() }

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockSearchParams.current
}))

describe('FitnessActivitySearch', () => {
  beforeEach(() => {
    mockReplace.mockReset()
    mockSearchParams.current = new URLSearchParams()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('debounces typing and writes ?q= via router.replace with scroll: false', () => {
    render(<FitnessActivitySearch />)

    const input = screen.getByRole('searchbox', { name: 'Search activities' })
    expect(input).toHaveAttribute('placeholder', 'Search activities')

    vi.useFakeTimers()
    fireEvent.change(input, { target: { value: 'tempo' } })

    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1)
    })
    expect(mockReplace).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(mockReplace).toHaveBeenCalledTimes(1)
    expect(mockReplace).toHaveBeenCalledWith('/fitness?q=tempo', {
      scroll: false
    })
  })

  it('preserves ?activity= when writing and clearing ?q=', () => {
    mockSearchParams.current = new URLSearchParams('activity=gravel_ride')
    const { rerender } = render(<FitnessActivitySearch />)

    const input = screen.getByRole('searchbox', { name: 'Search activities' })
    vi.useFakeTimers()
    fireEvent.change(input, { target: { value: 'canyon' } })

    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS)
    })
    expect(mockReplace).toHaveBeenCalledWith(
      '/fitness?activity=gravel_ride&q=canyon',
      { scroll: false }
    )

    mockSearchParams.current = new URLSearchParams(
      'activity=gravel_ride&q=canyon'
    )
    rerender(<FitnessActivitySearch query="canyon" />)

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))

    expect(mockReplace).toHaveBeenLastCalledWith(
      '/fitness?activity=gravel_ride',
      { scroll: false }
    )
    expect(input).toHaveValue('')
  })
})
