/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import Loading, { FavoritesLoading } from './loading'

describe('favorites loading', () => {
  it('renders loading favorites skeleton with accessibility attributes', () => {
    render(<Loading />)

    const loadingRegion = screen.getByLabelText('Loading favorites')
    expect(loadingRegion).toBeInTheDocument()
    expect(loadingRegion).toHaveAttribute('aria-busy', 'true')
  })

  it('exports FavoritesLoading named component', () => {
    render(<FavoritesLoading />)

    expect(screen.getByLabelText('Loading favorites')).toBeInTheDocument()
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

  it('renders outline components for header and favorite posts without composer or header action', () => {
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

    // No post composer on favorites page
    expect(screen.queryByLabelText('Post composer')).toBeNull()

    // Favorite posts section
    const postsSection = screen.getByLabelText('Favorite posts')
    expect(postsSection).toBeInTheDocument()
    expect(postsSection.children).toHaveLength(3)
  })
})
