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
})
