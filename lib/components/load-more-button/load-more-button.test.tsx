/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { LoadMoreButton } from './load-more-button'

describe('LoadMoreButton', () => {
  it('renders default button with "Load more" text', () => {
    render(<LoadMoreButton onClick={() => {}} />)
    const button = screen.getByRole('button', { name: 'Load more' })
    expect(button).toHaveAttribute('type', 'button')
    expect(button).not.toHaveAttribute('aria-busy')
    expect(button).toBeEnabled()
  })

  it('renders disabled button with loading text and aria-busy when isLoading is true', () => {
    render(<LoadMoreButton isLoading onClick={() => {}} />)
    const button = screen.getByRole('button', { name: 'Loading...' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  it('remains disabled even if disabled={false} is explicitly passed when isLoading is true', () => {
    render(<LoadMoreButton isLoading disabled={false} onClick={() => {}} />)
    const button = screen.getByRole('button', { name: 'Loading...' })
    expect(button).toBeDisabled()
  })

  it('renders custom children and custom loading text', () => {
    const { rerender } = render(
      <LoadMoreButton
        isLoading={false}
        loadingText="Fetching more..."
        onClick={() => {}}
      >
        Show more items
      </LoadMoreButton>
    )
    expect(
      screen.getByRole('button', { name: 'Show more items' })
    ).toBeInTheDocument()

    rerender(
      <LoadMoreButton
        isLoading={true}
        loadingText="Fetching more..."
        onClick={() => {}}
      >
        Show more items
      </LoadMoreButton>
    )
    expect(
      screen.getByRole('button', { name: 'Fetching more...' })
    ).toBeInTheDocument()
  })

  it('fires onClick when clicked', () => {
    const onClick = vi.fn()
    render(<LoadMoreButton onClick={onClick} />)
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not fire onClick when disabled', () => {
    const onClick = vi.fn()
    render(<LoadMoreButton disabled onClick={onClick} />)
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('does not wrap in div when container props are omitted', () => {
    const { container } = render(<LoadMoreButton onClick={() => {}} />)
    expect(container.firstElementChild?.tagName).toBe('BUTTON')
  })

  it('wraps in div when containerRef is passed', () => {
    const containerRef = createRef<HTMLDivElement>()
    const { container } = render(
      <LoadMoreButton containerRef={containerRef} onClick={() => {}} />
    )
    expect(container.firstElementChild?.tagName).toBe('DIV')
    expect(containerRef.current).toBe(container.firstElementChild)
  })

  it('renders error message in container when error prop is passed', () => {
    render(
      <LoadMoreButton error="Failed to load more posts" onClick={() => {}} />
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Failed to load more posts')
    expect(
      screen.getByRole('button', { name: 'Load more' })
    ).toBeInTheDocument()
  })

  it('wraps in a div carrying containerClassName when only that is passed', () => {
    const { container } = render(
      <LoadMoreButton containerClassName="flex my-4" onClick={() => {}} />
    )
    expect(container.firstElementChild?.tagName).toBe('DIV')
    expect(container.firstElementChild).toHaveClass('flex', 'my-4')
  })

  it('gives only the default size a minimum width', () => {
    const { rerender } = render(<LoadMoreButton onClick={() => {}} />)
    expect(screen.getByRole('button', { name: 'Load more' })).toHaveClass(
      'min-w-[110px]'
    )

    rerender(<LoadMoreButton size="sm" onClick={() => {}} />)
    expect(screen.getByRole('button', { name: 'Load more' })).not.toHaveClass(
      'min-w-[110px]'
    )
  })

  it('puts containerClassName on the containerRef wrapper when both are passed', () => {
    const containerRef = createRef<HTMLDivElement>()
    const { container } = render(
      <LoadMoreButton
        containerRef={containerRef}
        containerClassName="mt-6 text-center"
        onClick={() => {}}
      />
    )
    expect(containerRef.current).toBe(container.firstElementChild)
    expect(container.firstElementChild).toHaveClass('mt-6')
  })

  it('forwards button props such as size and aria attributes to the button', () => {
    render(
      <LoadMoreButton
        size="sm"
        aria-label="Load more feed statuses"
        onClick={() => {}}
      />
    )
    const button = screen.getByRole('button', {
      name: 'Load more feed statuses'
    })
    expect(button).toHaveAttribute('data-size', 'sm')
  })

  it.each([
    { hasItems: true, overlaid: true },
    { hasItems: false, overlaid: false }
  ])(
    'overlays the button on mobile only when it has items (hasItems=$hasItems)',
    ({ hasItems, overlaid }) => {
      const { container } = render(
        <LoadMoreButton
          presentation="overlay"
          hasItems={hasItems}
          onClick={() => {}}
        />
      )

      const wrapper = container.firstElementChild
      expect(wrapper?.tagName).toBe('DIV')
      expect(wrapper?.classList.contains('max-md:h-0')).toBe(overlaid)

      const button = screen.getByRole('button', { name: 'Load more' })
      expect(button.classList.contains('max-md:-translate-y-12')).toBe(overlaid)
    }
  )
})
