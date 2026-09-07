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
    // jsdom paints no CSS so classes are the observable; every leaf in
    // this skeleton is a placeholder (containers always hold further elements),
    // and a bare `length > 0` missed both a partial strip and a future
    // unstyled row; the `.skeleton` definition itself is guarded by
    // app/globals.skeleton.test.ts.
    const { container } = render(<Loading />)
    const leaves = Array.from(container.querySelectorAll('div, span')).filter(
      (el) => el.children.length === 0
    )
    expect(leaves.length).toBeGreaterThan(0)
    leaves.forEach((el) => expect(el).toHaveClass('skeleton'))
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })

  it('reuses PageHeader with matching header metrics', () => {
    const { container } = render(<Loading />)

    const stickyHeader = container.querySelector('.sticky')
    expect(stickyHeader).toBeInTheDocument()
    expect(stickyHeader).toHaveClass('top-0')
    expect(stickyHeader).toHaveClass('group-data-[shell=public]/shell:hidden')
    expect(stickyHeader?.querySelector('.max-w-content')).toBeInTheDocument()

    // Title row mirrors loaded PageHeader font metrics (h1 text-xl 28px -> h-7, back icon -> size-5)
    expect(stickyHeader?.querySelector('h1 .size-5')).toHaveClass('skeleton')
    expect(stickyHeader?.querySelector('h1 .h-7')).toHaveClass('skeleton')
    expect(stickyHeader?.querySelector('.mt-0\\.5 .skeleton')).toHaveClass(
      'h-4'
    )

    // Public shell alternative header exists
    expect(
      container.querySelector('.group-data-\\[shell\\=public\\]\\/shell\\:flex')
    ).toBeInTheDocument()

    // Has route metadata
    expect(screen.getByLabelText('Loading following')).toHaveAttribute(
      'data-route',
      'following'
    )
  })
})
