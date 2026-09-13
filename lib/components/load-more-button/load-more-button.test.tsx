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
    expect(button).toHaveAttribute('data-slot', 'button')
    expect(button).toHaveAttribute('data-variant', 'pill')
    expect(button).toHaveClass('rounded-full')
    expect(button).toBeEnabled()
  })

  it('renders disabled button with loading text when isLoading is true', () => {
    render(<LoadMoreButton isLoading onClick={() => {}} />)
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
    expect(containerRef.current).toBe(container.firstElementChild)
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
})
