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

  it('pads the top only from md up, so the cover sits flush on mobile', () => {
    const { container } = render(<Loading />)
    const root = container.firstElementChild
    expect(root).toHaveClass('md:pt-8')
    expect(root).not.toHaveClass('pt-6')
    expect(root).toHaveClass('group-data-[shell=public]/shell:pt-0')
    expect(container.querySelector('section')).toHaveClass(
      'max-md:rounded-none'
    )
  })
})
