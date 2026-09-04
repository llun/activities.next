/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'

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

  it('renders outline components for header, post composer, and timeline posts', () => {
    const { container } = render(<Loading />)

    const stickyHeader = container.querySelector('.sticky')
    expect(stickyHeader).toBeInTheDocument()
    expect(stickyHeader).toHaveClass('top-0')
    expect(stickyHeader?.querySelector('.max-w-content')).toBeInTheDocument()

    expect(screen.getByLabelText('Post composer')).toBeInTheDocument()
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
})
