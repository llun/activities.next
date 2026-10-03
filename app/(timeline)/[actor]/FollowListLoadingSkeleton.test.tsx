/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

import { breakoutStyle } from '@/lib/components/layout/chromeLayout'
import { MobileNavigationProvider } from '@/lib/components/layout/mobile-navigation-context'

import { FollowListLoadingSkeleton } from './FollowListLoadingSkeleton'

const ANON_HEADER = '.group-data-\\[shell\\=public\\]\\/shell\\:flex'

describe('FollowListLoadingSkeleton', () => {
  it.each([
    ['Loading followers', 'followers'],
    ['Loading following', 'following']
  ] as const)('renders with the given aria-label: %s', (label, route) => {
    render(<FollowListLoadingSkeleton label={label} route={route} />)

    const loadingRegion = screen.getByLabelText(label)
    expect(loadingRegion).toBeInTheDocument()
    expect(loadingRegion).toHaveAttribute('aria-busy', 'true')
  })

  it('renders every placeholder with the shimmer skeleton utility', () => {
    // jsdom paints no CSS so classes are the observable; every leaf in
    // this skeleton is a placeholder (containers always hold further elements).
    const { container } = render(
      <FollowListLoadingSkeleton label="Loading followers" route="followers" />
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
      <FollowListLoadingSkeleton label="Loading followers" route="followers" />
    )
    const stickyHeader = container.querySelector('.sticky')
    expect(stickyHeader).toBeInTheDocument()
    expect(stickyHeader).toHaveClass('top-0')
    expect(stickyHeader).toHaveClass('group-data-[shell=public]/shell:hidden')

    const anonHeader = container.querySelector(ANON_HEADER)
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
    const anonHeader = container.querySelector(ANON_HEADER)
    expect(anonHeader).toBeInTheDocument()
    expect(anonHeader).toHaveClass('items-start', 'gap-2')

    // Back icon skeleton matches ArrowLeft (size-5), its row nudged down by
    // mt-0.5 from md up like the loaded BackLink
    const backIcon = anonHeader?.querySelector('.size-5')
    expect(backIcon).toHaveClass('skeleton', 'shrink-0', 'rounded-md')
    expect(backIcon?.parentElement).toHaveClass('md:mt-0.5')

    // Text column contains h-7 title and h-4 description inside space-y-1
    const titleSkeleton = anonHeader?.querySelector('.h-7')
    expect(titleSkeleton).toHaveClass('skeleton', 'w-28', 'rounded-md')

    const descSkeleton = anonHeader?.querySelector('.h-4.w-24')
    expect(descSkeleton).toHaveClass('skeleton', 'rounded')

    expect(screen.getByLabelText('Loading following')).toHaveAttribute(
      'data-route',
      'following'
    )
  })

  // Below `md` the loaded page puts its plain title in the compact bar and
  // starts the content with a 44px "Back to profile" row. A skeleton title in
  // the bar, or no row, made the list jump down when it arrived.
  describe('below md', () => {
    const renderInShell = (route: 'followers' | 'following') =>
      render(
        <MobileNavigationProvider>
          <FollowListLoadingSkeleton label={`Loading ${route}`} route={route} />
        </MobileNavigationProvider>
      )

    it.each([
      ['followers', 'Followers'],
      ['following', 'Following']
    ] as const)(
      'names the %s page in the compact bar with a plain title',
      (route, title) => {
        const { container } = renderInShell(route)

        const bar = container.querySelector(
          '[data-mobile-compact-header]'
        ) as HTMLElement
        expect(bar).toBeInTheDocument()
        expect(bar).toHaveClass('mb-0')
        expect(within(bar).getByText(title)).toHaveAttribute('title', title)
        expect(bar.querySelector('.skeleton')).toBeNull()
      }
    )

    it('swaps the signed-in header box for the loaded mobile content', () => {
      const { container } = renderInShell('followers')

      // The PageHeader box is the desktop header only…
      const box = container.querySelector('.max-w-content')?.parentElement
      expect(box).toHaveClass('max-md:hidden')
      expect(box).toHaveClass('group-data-[shell=public]/shell:hidden')

      // …and the mobile block mirrors it, breaking out of the content column
      // like the box: pt-2, the 44px Back row, then the count on the flush
      // 20px line the loaded description draws below md.
      const mobile = box?.nextElementSibling as HTMLElement
      expect(mobile).toHaveClass(
        'md:hidden',
        'group-data-[shell=public]/shell:hidden'
      )
      expect(mobile.style.marginLeft).toBe(breakoutStyle.marginLeft)
      expect(mobile.style.marginRight).toBe(breakoutStyle.marginRight)
      const inner = mobile.firstElementChild as HTMLElement
      expect(inner).toHaveClass('px-4', 'pt-2', 'pb-4', 'max-w-content')
      const backRow = inner.firstElementChild as HTMLElement
      expect(backRow).toHaveClass('max-md:min-h-11', 'items-center')
      // The label beside the arrow is the mobile row's only; from `md` up the
      // loaded Back is the bare icon.
      expect(backRow.lastElementChild).toHaveClass(
        'skeleton',
        'w-28',
        'md:hidden'
      )
      const count = inner.lastElementChild as HTMLElement
      expect(count).toHaveClass('skeleton', 'h-5')
      expect(count).not.toHaveClass('mt-0.5')
    })

    it('mirrors the logged-out mobile header: Back row over the text-sm count', () => {
      const { container } = renderInShell('following')

      const anonHeader = container.querySelector(ANON_HEADER) as HTMLElement
      expect(anonHeader).toHaveClass(
        'max-md:flex-col',
        'max-md:gap-0',
        'max-md:pt-2'
      )
      expect(anonHeader.firstElementChild).toHaveClass('max-md:min-h-11')
      // The row's arrow is the 16px, gutter-aligned one the loaded page draws.
      expect(anonHeader.firstElementChild?.className).not.toContain(
        'max-md:-ml-1'
      )
      expect(anonHeader.firstElementChild?.firstElementChild).toHaveClass(
        'max-md:size-4'
      )
      expect(anonHeader.firstElementChild?.lastElementChild).toHaveClass(
        'skeleton',
        'w-28',
        'md:hidden'
      )
      // The title is the bar's below md, and the count is a 20px line.
      expect(anonHeader.querySelector('.h-7')).toHaveClass('max-md:hidden')
      expect(anonHeader.querySelector('.h-4.w-24')).toHaveClass('max-md:h-5')
    })
  })
})
