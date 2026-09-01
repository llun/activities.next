/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import Loading, { ProfileLoading } from './loading'

describe('[actor] loading', () => {
  it('renders loading profile skeleton with accessibility attributes', () => {
    render(<Loading />)

    const loadingRegion = screen.getByLabelText('Loading profile')
    expect(loadingRegion).toBeInTheDocument()
    expect(loadingRegion).toHaveAttribute('aria-busy', 'true')
  })

  it('exports ProfileLoading named component', () => {
    render(<ProfileLoading />)

    expect(screen.getByLabelText('Loading profile')).toBeInTheDocument()
  })

  it('renders placeholders with the shimmer skeleton utility', () => {
    const { container } = render(<Loading />)

    // jsdom paints no CSS, so the class is the observable: the shimmer lives
    // on the `skeleton` utility (app/globals.css, guarded by
    // app/globals.skeleton.test.ts), and the old animate-pulse-on-bg-muted
    // treatment — near-invisible in light mode — must not come back.
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0)
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })
})
