/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import Loading from './loading'

describe('messages loading', () => {
  it('renders loading messages skeleton with accessibility attributes', () => {
    render(<Loading />)

    const loadingRegion = screen.getByLabelText('Loading messages')
    expect(loadingRegion).toBeInTheDocument()
    expect(loadingRegion).toHaveAttribute('aria-busy', 'true')
  })

  it('draws no text on screen, only one polite Loading for assistive tech', () => {
    const { container } = render(<Loading />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading messages')
    expect(container.textContent).toBe('Loading messages')
  })

  it('renders conversation list and conversation thread landmark regions', () => {
    render(<Loading />)

    expect(screen.getByLabelText('Direct messages')).toBeInTheDocument()
    expect(screen.getByLabelText('Conversation list')).toBeInTheDocument()
    expect(screen.getByLabelText('Conversation thread')).toBeInTheDocument()
    expect(screen.getByLabelText('Message thread')).toBeInTheDocument()
  })

  it('draws the two panes inside one frame of shimmer bars', () => {
    const { container } = render(<Loading />)

    expect(container.querySelectorAll('[data-slot="frame"]')).toHaveLength(1)
    expect(
      screen
        .getByLabelText('Direct messages')
        .querySelectorAll('[data-slot="skeleton-bar"]').length
    ).toBeGreaterThan(10)
  })
})
