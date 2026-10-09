/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { AlbumUndoToast } from './AlbumUndoToast'
import type { AlbumToast } from './useMediaAlbums'

const toast = (overrides: Partial<AlbumToast> = {}): AlbumToast => ({
  id: 1,
  message: 'Added to “Kruger”',
  undo: vi.fn(),
  ...overrides
})

describe('AlbumUndoToast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the message and runs Undo once', () => {
    const undo = vi.fn()
    render(<AlbumUndoToast toast={toast({ undo })} onDismiss={vi.fn()} />)

    expect(screen.getByText('Added to “Kruger”')).toBeVisible()
    const button = screen.getByRole('button', { name: 'Undo' })
    fireEvent.click(button)
    fireEvent.click(button)

    expect(undo).toHaveBeenCalledTimes(1)
    // It stays (and keeps focus) but says it is spent.
    expect(button).toHaveAttribute('aria-disabled', 'true')
  })

  it('has no Undo when there is nothing to undo', () => {
    render(<AlbumUndoToast toast={toast({ undo: null })} onDismiss={vi.fn()} />)

    expect(
      screen.queryByRole('button', { name: 'Undo' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeVisible()
  })

  it('goes away after its time', () => {
    const onDismiss = vi.fn()
    render(
      <AlbumUndoToast toast={toast()} onDismiss={onDismiss} durationMs={1000} />
    )

    act(() => {
      vi.advanceTimersByTime(999)
    })
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('waits while the pointer is on it and starts again when it leaves', () => {
    const onDismiss = vi.fn()
    render(
      <AlbumUndoToast toast={toast()} onDismiss={onDismiss} durationMs={1000} />
    )
    const box = screen.getByTestId('album-toast')

    fireEvent.mouseEnter(box)
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(onDismiss).not.toHaveBeenCalled()

    fireEvent.mouseLeave(box)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('waits while focus is inside it', () => {
    const onDismiss = vi.fn()
    render(
      <AlbumUndoToast toast={toast()} onDismiss={onDismiss} durationMs={1000} />
    )

    fireEvent.focus(screen.getByRole('button', { name: 'Undo' }))
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('starts the wait again, and re-arms Undo, for a new message', () => {
    const onDismiss = vi.fn()
    const first = toast({ id: 1 })
    const { rerender } = render(
      <AlbumUndoToast toast={first} onDismiss={onDismiss} durationMs={1000} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    act(() => {
      vi.advanceTimersByTime(600)
    })

    rerender(
      <AlbumUndoToast
        toast={toast({ id: 2, message: 'Removed from “Kruger”' })}
        onDismiss={onDismiss}
        durationMs={1000}
      />
    )
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(onDismiss).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Undo' })).not.toHaveAttribute(
      'aria-disabled'
    )
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('dismisses from the close button', () => {
    const onDismiss = vi.fn()
    render(<AlbumUndoToast toast={toast()} onDismiss={onDismiss} />)

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
