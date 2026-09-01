/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import Loading, { FollowingLoading } from './loading'

describe('[actor]/following loading', () => {
  it('renders loading following skeleton with accessibility attributes', () => {
    render(<Loading />)

    const loadingRegion = screen.getByLabelText('Loading following')
    expect(loadingRegion).toBeInTheDocument()
    expect(loadingRegion).toHaveAttribute('aria-busy', 'true')
  })

  it('exports FollowingLoading named component', () => {
    render(<FollowingLoading />)

    expect(screen.getByLabelText('Loading following')).toBeInTheDocument()
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
})
