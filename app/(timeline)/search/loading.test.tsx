/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'

import Loading, { SearchLoading } from './loading'

describe('search loading', () => {
  it('renders loading search skeleton with accessibility attributes', () => {
    render(<Loading />)

    const loadingRegion = screen.getByLabelText('Loading search')
    expect(loadingRegion).toBeInTheDocument()
    expect(loadingRegion).toHaveAttribute('aria-busy', 'true')
  })

  it('exports SearchLoading named component', () => {
    render(<SearchLoading />)

    expect(screen.getByLabelText('Loading search')).toBeInTheDocument()
  })

  it('renders every placeholder with the shimmer skeleton utility', () => {
    const { container } = render(<Loading />)
    const leaves = Array.from(container.querySelectorAll('div, span')).filter(
      (el) => el.children.length === 0
    )
    expect(leaves.length).toBeGreaterThan(0)
    leaves.forEach((el) => expect(el).toHaveClass('skeleton'))
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })

  it('renders outline components for header, search form, search tabs, and search results', () => {
    const { container } = render(<Loading />)

    const stickyHeader = container.querySelector('.sticky')
    expect(stickyHeader).toBeInTheDocument()
    expect(stickyHeader).toHaveClass('top-0')
    expect(stickyHeader?.querySelector('.max-w-content')).toBeInTheDocument()

    // Skeletons in the header mirror PageHeader font metrics (text-xl 28px -> h-7, text-xs 16px -> h-4)
    expect(stickyHeader?.querySelector('h1 .skeleton')).toHaveClass('h-7')
    expect(stickyHeader?.querySelector('h1 + div .skeleton')).toHaveClass('h-4')
    // No action button in header
    expect(stickyHeader?.querySelector('.shrink-0')).toBeNull()

    // No post composer on search page
    expect(screen.queryByLabelText('Post composer')).toBeNull()

    // Search form skeleton
    const formSection = screen.getByLabelText('Search form')
    expect(formSection).toBeInTheDocument()
    expect(formSection.querySelector('.flex-1.skeleton')).toHaveClass('h-11')
    expect(formSection.querySelector('.shrink-0.skeleton')).toHaveClass('h-11')

    // Search tabs skeleton (4 tabs: all, accounts, statuses, hashtags)
    const tabsSection = screen.getByLabelText('Search tabs')
    expect(tabsSection).toBeInTheDocument()
    expect(tabsSection.children).toHaveLength(4)
    Array.from(tabsSection.children).forEach((tab) => {
      expect(tab).toHaveClass('skeleton', 'h-8', 'rounded-md')
    })

    // Search results section with outlines for profile, post, and hashtag results
    const resultsSection = screen.getByLabelText('Search results')
    expect(resultsSection).toBeInTheDocument()
    expect(resultsSection.children).toHaveLength(3)

    // Profile item outline (size-11 avatar)
    expect(
      resultsSection.children[0]?.querySelector('.skeleton.size-11')
    ).toBeInTheDocument()

    // Post item outline (size-10 avatar and 4 actions)
    expect(
      resultsSection.children[1]?.querySelector('.skeleton.size-10')
    ).toBeInTheDocument()
    const postActions =
      resultsSection.children[1]?.querySelectorAll('.pt-2 .skeleton')
    expect(postActions).toHaveLength(4)

    // Hashtag item outline (size-10 circle)
    expect(
      resultsSection.children[2]?.querySelector('.skeleton.size-10')
    ).toBeInTheDocument()
  })

  it('is scoped to the search route so it does not cascade to other (timeline) subroutes', () => {
    const rootTimelineLoadingPath = path.resolve(
      process.cwd(),
      'app/(timeline)/loading.tsx'
    )
    expect(fs.existsSync(rootTimelineLoadingPath)).toBe(false)
  })
})
