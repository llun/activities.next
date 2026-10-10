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

  it('shows what happened, with the action', () => {
    const { onSelect } = renderToast()

    expect(screen.getByTestId('gallery-added-toast')).toHaveTextContent(
      '3 added to your gallery.'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Post them' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('has no live region of its own: the page announces it', () => {
    renderToast()

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('disables the action and says why', () => {
    const onSelect = vi.fn()
    renderToast({
      action: {
        label: 'Post them',
        onSelect,
        disabled: true,
        hint: 'Up to 4 per post'
      }
    })

    const button = screen.getByRole('button', { name: 'Post them' })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription('Up to 4 per post')
    fireEvent.click(button)
    expect(onSelect).not.toHaveBeenCalled()
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
