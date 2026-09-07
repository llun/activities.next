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
    // jsdom paints no CSS so classes are the observable; every leaf in
    // this skeleton is a placeholder (containers always hold further elements).
    const { container } = render(
      <FollowListLoadingSkeleton label="Loading followers" />
    )
    const leaves = Array.from(container.querySelectorAll('div, span')).filter(
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

  it('composes PageHeader with matching font, icon, and padding metrics for signed-in shell', () => {
    const { container } = render(
      <FollowListLoadingSkeleton label="Loading followers" route="followers" />
    )
    const stickyHeader = container.querySelector('.sticky')
    expect(stickyHeader).toBeInTheDocument()

    // PageHeader container properties
    const innerContainer = stickyHeader?.querySelector('.max-w-content')
    expect(innerContainer).toBeInTheDocument()
    expect(innerContainer).toHaveClass('px-4', 'py-4')

    // Title row mirrors loaded PageHeader: h1 text-xl with flex items-center gap-2
    const h1 = stickyHeader?.querySelector('h1')
    expect(h1).toHaveClass('text-xl', 'font-semibold', 'tracking-tight')

    const titleFlex = h1?.querySelector('.flex')
    expect(titleFlex).toHaveClass('items-center', 'gap-2')

    // Back button skeleton in title flex matches ArrowLeft (size-5)
    const backButtonSkeleton = titleFlex?.querySelector('.size-5')
    expect(backButtonSkeleton).toBeInTheDocument()
    expect(backButtonSkeleton).toHaveClass('skeleton', 'rounded-md')

    // Title text skeleton matches h1 line height (28px -> h-7)
    const titleTextSkeleton = titleFlex?.querySelector('.h-7')
    expect(titleTextSkeleton).toBeInTheDocument()
    expect(titleTextSkeleton).toHaveClass('skeleton', 'w-28', 'rounded-md')

    // Description skeleton under h1 matches text-xs line height (16px -> h-4)
    const descWrapper = stickyHeader?.querySelector('.mt-0\\.5')
    expect(descWrapper).toHaveClass('text-xs', 'text-muted-foreground')
    const descSkeleton = descWrapper?.querySelector('.skeleton')
    expect(descSkeleton).toHaveClass('h-4', 'w-24', 'rounded')

    // Root element preserves data-route
    expect(screen.getByLabelText('Loading followers')).toHaveAttribute(
      'data-route',
      'followers'
    )
  })

  it('renders public shell header matching loaded non-sticky geometry', () => {
    const { container } = render(
      <FollowListLoadingSkeleton label="Loading following" route="following" />
    )
    const anonHeader = container.querySelector(
      '.group-data-\\[shell\\=public\\]\\/shell\\:flex'
    )
    expect(anonHeader).toBeInTheDocument()
    expect(anonHeader).toHaveClass('items-start', 'gap-2')

    // Back icon skeleton matches ArrowLeft with mt-0.5 and size-5
    const backIcon = anonHeader?.querySelector('.size-5')
    expect(backIcon).toHaveClass('skeleton', 'mt-0.5', 'shrink-0', 'rounded-md')

    // Text column contains h-7 title and h-4 description inside space-y-1
    const titleSkeleton = anonHeader?.querySelector('.h-7')
    expect(titleSkeleton).toHaveClass('skeleton', 'w-28', 'rounded-md')

    const descSkeleton = anonHeader?.querySelector('.h-4')
    expect(descSkeleton).toHaveClass('skeleton', 'w-24', 'rounded')

    expect(screen.getByLabelText('Loading following')).toHaveAttribute(
      'data-route',
      'following'
    )
  })
})
