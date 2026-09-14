/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { LoadMoreButton } from './load-more-button'

describe('LoadMoreButton', () => {
  it('renders default button with "Load more" text and pill variant', () => {
    render(<LoadMoreButton onClick={() => {}} />)
    const button = screen.getByRole('button', { name: 'Load more' })
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveAttribute('data-slot', 'button')
    expect(button).toHaveAttribute('data-variant', 'pill')
    expect(button).toHaveClass('rounded-full')
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

  it('wraps in div with default text-center class when containerRef is passed', () => {
    const containerRef = createRef<HTMLDivElement>()
    const { container } = render(
      <LoadMoreButton containerRef={containerRef} onClick={() => {}} />
    )
    expect(container.firstElementChild?.tagName).toBe('DIV')
    expect(container.firstElementChild).toHaveClass('text-center')
    expect(container.firstElementChild).toHaveClass('py-4')
    expect(container.firstElementChild).toHaveClass('max-md:pt-6')
    expect(container.firstElementChild).toHaveClass(
      'max-md:pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)]'
    )
    expect(containerRef.current).toBe(container.firstElementChild)
  })

  it('renders error message in container when error prop is passed', () => {
    render(
      <LoadMoreButton error="Failed to load more posts" onClick={() => {}} />
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Failed to load more posts')
    expect(alert).toHaveClass('text-destructive')
    expect(
      screen.getByRole('button', { name: 'Load more' })
    ).toBeInTheDocument()
  })

  it('wraps in div with custom containerClassName when passed', () => {
    const { container } = render(
      <LoadMoreButton
        containerClassName="flex justify-center my-4"
        onClick={() => {}}
      >
        Custom
      </LoadMoreButton>
    )
    expect(container.firstElementChild?.tagName).toBe('DIV')
    expect(container.firstElementChild).toHaveClass('flex justify-center my-4')
  })

  it('attaches containerRef and applies containerClassName when both are passed', () => {
    const containerRef = createRef<HTMLDivElement>()
    const { container } = render(
      <LoadMoreButton
        containerRef={containerRef}
        containerClassName="mt-6 text-center"
        onClick={() => {}}
      />
    )
    expect(container.firstElementChild?.tagName).toBe('DIV')
    expect(container.firstElementChild).toHaveClass('mt-6 text-center')
    expect(containerRef.current).toBe(container.firstElementChild)
  })

  it('forwards button props such as size, className, and aria attributes to the button', () => {
    render(
      <LoadMoreButton
        size="sm"
        className="extra-button-class"
        aria-label="Load more feed statuses"
        onClick={() => {}}
      />
    )
    const button = screen.getByRole('button', {
      name: 'Load more feed statuses'
    })
    expect(button).toHaveAttribute('data-size', 'sm')
    expect(button).toHaveClass('extra-button-class')
  })
})
