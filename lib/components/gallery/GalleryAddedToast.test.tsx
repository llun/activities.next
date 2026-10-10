/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { GalleryAddedToast } from './GalleryAddedToast'

describe('GalleryAddedToast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const renderToast = (
    props: Partial<React.ComponentProps<typeof GalleryAddedToast>> = {}
  ) => {
    const onDismiss = vi.fn()
    const onSelect = vi.fn()
    render(
      <GalleryAddedToast
        id={1}
        message="3 added to your gallery."
        action={{ label: 'Post them', onSelect }}
        onDismiss={onDismiss}
        durationMs={1000}
        {...props}
      />
    )
    return { onDismiss, onSelect }
  }

  it('says what happened in a status region, with the action', () => {
    const { onSelect } = renderToast()

    expect(screen.getByRole('status')).toHaveTextContent(
      '3 added to your gallery.'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Post them' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('goes away on its own', () => {
    const { onDismiss } = renderToast()

    act(() => vi.advanceTimersByTime(999))
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('waits while the pointer or focus is on it', () => {
    const { onDismiss } = renderToast()
    const toast = screen.getByTestId('gallery-added-toast')

    fireEvent.mouseEnter(toast)
    act(() => vi.advanceTimersByTime(5000))
    expect(onDismiss).not.toHaveBeenCalled()

    fireEvent.mouseLeave(toast)
    fireEvent.focus(screen.getByRole('button', { name: 'Post them' }))
    act(() => vi.advanceTimersByTime(5000))
    expect(onDismiss).not.toHaveBeenCalled()

    fireEvent.blur(screen.getByRole('button', { name: 'Post them' }))
    act(() => vi.advanceTimersByTime(1000))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('can be dismissed', () => {
    const { onDismiss } = renderToast()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('has no action button without one', () => {
    renderToast({ action: undefined })
    expect(
      screen.queryByRole('button', { name: 'Post them' })
    ).not.toBeInTheDocument()
  })
})
