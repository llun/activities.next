/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import Loading, { MessagesLoading } from './loading'

describe('messages loading', () => {
  it('renders loading messages skeleton with accessibility attributes', () => {
    render(<Loading />)

    const loadingRegion = screen.getByLabelText('Loading messages')
    expect(loadingRegion).toBeInTheDocument()
    expect(loadingRegion).toHaveAttribute('aria-busy', 'true')
  })

  it('exports MessagesLoading named component', () => {
    render(<MessagesLoading />)

    expect(screen.getByLabelText('Loading messages')).toBeInTheDocument()
  })

  it('renders every placeholder with the shimmer skeleton utility', () => {
    // jsdom paints no CSS so classes are the observable; every leaf <div> in
    // this skeleton is a placeholder (containers always hold further divs),
    // and a bare `length > 0` missed both a partial strip and a future
    // unstyled row; the `.skeleton` definition itself is guarded by
    // app/globals.skeleton.test.ts.
    const { container } = render(<Loading />)
    const leaves = Array.from(container.querySelectorAll('div')).filter(
      (el) => el.children.length === 0
    )
    expect(leaves.length).toBeGreaterThan(0)
    leaves.forEach((el) => expect(el).toHaveClass('skeleton'))
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })

  it('renders conversation list and conversation thread landmark regions', () => {
    render(<Loading />)

    expect(screen.getByLabelText('Direct messages')).toBeInTheDocument()
    expect(screen.getByLabelText('Conversation list')).toBeInTheDocument()
    expect(screen.getByLabelText('Conversation thread')).toBeInTheDocument()
    expect(screen.getByLabelText('Message thread')).toBeInTheDocument()
  })
})
