/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { FollowListLoadingSkeleton } from './FollowListLoadingSkeleton'

describe('FollowListLoadingSkeleton', () => {
  it.each([['Loading followers'], ['Loading following']])(
    'renders with the given aria-label: %s',
    (label) => {
      render(<FollowListLoadingSkeleton label={label} />)

      const loadingRegion = screen.getByLabelText(label)
      expect(loadingRegion).toBeInTheDocument()
      expect(loadingRegion).toHaveAttribute('aria-busy', 'true')
    }
  )

  it('renders every placeholder with the shimmer skeleton utility', () => {
    // jsdom paints no CSS so classes are the observable; every leaf <div> in
    // this skeleton is a placeholder (containers always hold further divs).
    const { container } = render(
      <FollowListLoadingSkeleton label="Loading followers" />
    )
    const leaves = Array.from(container.querySelectorAll('div')).filter(
      (el) => el.children.length === 0
    )
    expect(leaves.length).toBeGreaterThan(0)
    leaves.forEach((el) => expect(el).toHaveClass('skeleton'))
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })

  it('renders dual header variants for signed-in and anonymous shells', () => {
    const { container } = render(
      <FollowListLoadingSkeleton label="Loading followers" />
    )
    const stickyHeader = container.querySelector('.sticky')
    expect(stickyHeader).toBeInTheDocument()
    expect(stickyHeader).toHaveClass('top-0')
    expect(stickyHeader).toHaveClass('group-data-[shell=public]/shell:hidden')

    const anonHeader = container.querySelector(
      '.group-data-\\[shell\\=public\\]\\/shell\\:flex'
    )
    expect(anonHeader).toBeInTheDocument()
    expect(anonHeader).toHaveClass('hidden')
  })
})
