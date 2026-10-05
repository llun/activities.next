/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'

import { MobileNavigationProvider } from '@/lib/components/layout/mobile-navigation-context'

import Loading, { TimelineLoading } from './loading'

describe('timeline loading', () => {
  it('renders loading timeline skeleton with accessibility attributes', () => {
    render(<Loading />)

    const loadingRegion = screen.getByLabelText('Loading timeline')
    expect(loadingRegion).toBeInTheDocument()
    expect(loadingRegion).toHaveAttribute('aria-busy', 'true')
  })

  it('exports TimelineLoading named component', () => {
    render(<TimelineLoading />)

    expect(screen.getByLabelText('Loading timeline')).toBeInTheDocument()
  })

  it('renders every placeholder with the shimmer skeleton utility', () => {
    // jsdom paints no CSS so classes are the observable; every visible leaf
    // <div>/<span> in this skeleton is a placeholder (containers always hold
    // further elements). The aria-hidden divider is decorative layout chrome,
    // not a loading placeholder. A bare `length > 0` missed both a partial
    // strip and a future unstyled row; the `.skeleton` definition itself is
    // guarded by app/globals.skeleton.test.ts.
    const { container } = render(<Loading />)
    const leaves = Array.from(container.querySelectorAll('div, span')).filter(
      (el) => el.children.length === 0 && el.ariaHidden !== 'true'
    )
    expect(leaves.length).toBeGreaterThan(0)
    leaves.forEach((el) => expect(el).toHaveClass('skeleton'))
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })

  it('renders outline components for header, post composer, and timeline posts', () => {
    const { container } = render(<Loading />)

    const stickyHeader = container.querySelector('.sticky')
    expect(stickyHeader).toBeInTheDocument()
    expect(stickyHeader).toHaveClass('top-0')
    expect(stickyHeader?.querySelector('.max-w-content')).toBeInTheDocument()

    // Skeletons in the header mirror PageHeader font and action metrics
    // (text-xl 28px -> h-7, action button -> size-9 with self-center); the
    // loaded page has no description, so neither does the skeleton.
    expect(stickyHeader?.querySelector('h1 .skeleton')).toHaveClass('h-7')
    expect(stickyHeader?.querySelector('h1 + div')).toBeNull()
    expect(stickyHeader?.querySelector('.shrink-0')).toHaveClass('self-center')
    expect(stickyHeader?.querySelector('.shrink-0 .skeleton')).toHaveClass(
      'size-9'
    )

    // Without the signed-in mobile navigation (the logged-out home route)
    // the header keeps its sticky box, and the composer meets its border.
    expect(stickyHeader).not.toHaveClass('max-md:hidden')
    expect(stickyHeader).toHaveClass('max-md:mb-0')
    expect(stickyHeader?.nextElementSibling).toBe(
      screen.getByLabelText('Post composer')
    )
    expect(screen.getByLabelText('Post composer')).not.toHaveClass(
      'max-md:-mt-6'
    )
    const postsSection = screen.getByLabelText('Timeline posts')
    expect(postsSection).toBeInTheDocument()
    expect(postsSection.children).toHaveLength(3)
  })

  it('is scoped to the home route group so it does not cascade to other (timeline) subroutes', () => {
    // Next.js cascades loading.tsx to all nested route segments in the same
    // directory tree. To prevent TimelineLoading from appearing on /notifications,
    // /bookmarks, /settings, etc., it must remain in (home)/ and not at the root
    // of (timeline)/.
    const rootTimelineLoadingPath = path.resolve(
      process.cwd(),
      'app/(timeline)/loading.tsx'
    )
    expect(fs.existsSync(rootTimelineLoadingPath)).toBe(false)
  })

  it('meets the signed-in mobile bar with the composer, as the loaded page does', () => {
    const { container } = render(
      <MobileNavigationProvider>
        <Loading />
      </MobileNavigationProvider>
    )

    // Below md the bar carries the title and Refresh, so the header box is
    // hidden and the composer meets the bar's hairline with no gap; it does not
    // jump when the page arrives.
    const bar = container.querySelector(
      '[data-mobile-compact-header]'
    ) as HTMLElement
    expect(bar).toHaveClass('mb-0')
    const box = bar.nextElementSibling as HTMLElement
    expect(box).toHaveClass('max-md:hidden')
    expect(box.nextElementSibling).toBe(screen.getByLabelText('Post composer'))
    // The Refresh placeholder sits at the end of the bar, as the loaded
    // page's button does.
    expect(bar.lastElementChild?.firstElementChild).toHaveClass(
      'skeleton',
      'size-9'
    )
  })
})
