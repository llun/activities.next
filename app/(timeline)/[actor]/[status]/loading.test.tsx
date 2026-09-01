/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import Loading, { StatusLoading } from './loading'

describe('[status] loading', () => {
  it('renders loading post skeleton with accessibility attributes', () => {
    render(<Loading />)

    const loadingRegion = screen.getByLabelText('Loading post')
    expect(loadingRegion).toBeInTheDocument()
    expect(loadingRegion).toHaveAttribute('aria-busy', 'true')
  })

  it('exports StatusLoading named component', () => {
    render(<StatusLoading />)

    expect(screen.getByLabelText('Loading post')).toBeInTheDocument()
  })

  it('renders placeholders with the shimmer skeleton utility', () => {
    const { container } = render(<Loading />)

    // jsdom paints no CSS, so the class is the observable — see
    // app/globals.skeleton.test.ts for the definition guard.
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0)
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })
})
