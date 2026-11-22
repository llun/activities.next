/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DebouncedSearchInput,
  SEARCH_DEBOUNCE_MS
} from './debounced-search-input'

describe('DebouncedSearchInput', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('debounces typing across the timeout boundary before calling onSearchChange', () => {
    const onSearchChange = vi.fn()
    render(
      <DebouncedSearchInput
        value=""
        onSearchChange={onSearchChange}
        ariaLabel="Search photos"
        placeholder="Search photos"
      />
    )

    const input = screen.getByRole('searchbox', { name: 'Search photos' })
    expect(input).toHaveAttribute('placeholder', 'Search photos')
    expect(
      screen.queryByRole('button', { name: 'Clear search' })
    ).not.toBeInTheDocument()

    vi.useFakeTimers()
    fireEvent.change(input, { target: { value: 'kingfisher' } })

    expect(
      screen.getByRole('button', { name: 'Clear search' })
    ).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1)
    })
    expect(onSearchChange).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onSearchChange).toHaveBeenCalledTimes(1)
    expect(onSearchChange).toHaveBeenCalledWith('kingfisher')
  })

  it('resets the debounce timer when the user keeps typing', () => {
    const onSearchChange = vi.fn()
    render(
      <DebouncedSearchInput
        value=""
        onSearchChange={onSearchChange}
        ariaLabel="Search photos"
        placeholder="Search photos"
      />
    )

    const input = screen.getByRole('searchbox', { name: 'Search photos' })
    vi.useFakeTimers()

    fireEvent.change(input, { target: { value: 'king' } })
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 50)
    })
    fireEvent.change(input, { target: { value: 'kingfisher' } })

    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1)
    })
    expect(onSearchChange).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onSearchChange).toHaveBeenCalledTimes(1)
    expect(onSearchChange).toHaveBeenCalledWith('kingfisher')
  })

  it('clears immediately when the clear button is clicked and returns focus to the input', () => {
    const onSearchChange = vi.fn()
    render(
      <DebouncedSearchInput
        value="kingfisher"
        onSearchChange={onSearchChange}
        ariaLabel="Search photos"
        placeholder="Search photos"
      />
    )

    const input = screen.getByRole('searchbox', { name: 'Search photos' })
    expect(input).toHaveValue('kingfisher')

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))

    expect(input).toHaveValue('')
    expect(document.activeElement).toBe(input)
    expect(onSearchChange).toHaveBeenCalledTimes(1)
    expect(onSearchChange).toHaveBeenCalledWith('')
  })

  it('flushes immediately on Enter without waiting for the debounce timer', () => {
    const onSearchChange = vi.fn()
    render(
      <DebouncedSearchInput
        value=""
        onSearchChange={onSearchChange}
        ariaLabel="Search photos"
        placeholder="Search photos"
      />
    )

    const input = screen.getByRole('searchbox', { name: 'Search photos' })
    vi.useFakeTimers()

    fireEvent.change(input, { target: { value: '  owl  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSearchChange).toHaveBeenCalledTimes(1)
    expect(onSearchChange).toHaveBeenCalledWith('owl')

    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS)
    })
    expect(onSearchChange).toHaveBeenCalledTimes(1)
  })

  it('syncs external value changes and cancels pending timers on unmount', () => {
    const onSearchChange = vi.fn()
    const { rerender, unmount } = render(
      <DebouncedSearchInput
        value="fox"
        onSearchChange={onSearchChange}
        ariaLabel="Search photos"
        placeholder="Search photos"
      />
    )

    const input = screen.getByRole('searchbox', { name: 'Search photos' })
    vi.useFakeTimers()

    fireEvent.change(input, { target: { value: 'foxes' } })
    rerender(
      <DebouncedSearchInput
        value=""
        onSearchChange={onSearchChange}
        ariaLabel="Search photos"
        placeholder="Search photos"
      />
    )
    expect(input).toHaveValue('')

    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS)
    })
    expect(onSearchChange).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: 'heron' } })
    unmount()
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS)
    })
    expect(onSearchChange).not.toHaveBeenCalled()
  })
})
