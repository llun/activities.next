/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'

import Page from './page'

const getAllHashtags = vi.fn()
const mockDatabase = { getAllHashtags }

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => mockDatabase)
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({
    user: { email: 'admin@llun.test' }
  })
}))

vi.mock('@/lib/utils/getAdminFromSession', () => ({
  getAdminFromSession: vi.fn().mockResolvedValue({
    id: 'admin',
    email: 'admin@llun.test'
  })
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`Unexpected redirect to ${path}`)
  })
}))

const hashtag = (name: string, postCount: number, latestPostAt?: number) => ({
  name,
  postCount,
  latestPostAt: latestPostAt ?? null
})

const renderPage = async (searchParams: Record<string, string> = {}) =>
  render(await Page({ searchParams: Promise.resolve(searchParams) }))

describe('/admin/tags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists hashtags in a table with their post counts and last activity', async () => {
    getAllHashtags.mockResolvedValue({
      hashtags: [
        hashtag('#fediverse', 12, Date.UTC(2026, 9, 1, 8, 30)),
        hashtag('#cats', 1)
      ],
      total: 2
    })

    await renderPage()

    const table = screen.getByRole('table', { name: 'Hashtags' })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent)
    ).toEqual(['Hashtag', 'Posts', 'Latest post'])
    const [, first, second] = within(table).getAllByRole('row')
    expect(
      within(first).getByRole('link', { name: 'fediverse' })
    ).toHaveAttribute('href', '/admin/tags/fediverse')
    expect(within(first).getByText(/^12/)).toBeInTheDocument()
    expect(within(second).getByText('—')).toBeInTheDocument()
  })

  it('sorts through links, alphabetical by default', async () => {
    getAllHashtags.mockResolvedValue({ hashtags: [hashtag('#a', 1)], total: 1 })

    await renderPage()

    const nav = screen.getByRole('navigation', { name: 'Sort hashtags' })
    expect(
      within(nav).getByRole('link', { name: 'Alphabetical' })
    ).toHaveAttribute('aria-current', 'page')
    expect(
      within(nav).getByRole('link', { name: 'Most posts' })
    ).toHaveAttribute('href', '/admin/tags?sort=count&page=1')
    expect(getAllHashtags).toHaveBeenCalledWith({
      limit: 20,
      offset: 0,
      sort: 'alphabetical'
    })
  })

  it('marks the chosen sort and asks the database for it', async () => {
    getAllHashtags.mockResolvedValue({ hashtags: [hashtag('#a', 1)], total: 1 })

    await renderPage({ sort: 'recent' })

    expect(
      screen.getByRole('link', { name: 'Recently active' })
    ).toHaveAttribute('aria-current', 'page')
    expect(getAllHashtags).toHaveBeenCalledWith({
      limit: 20,
      offset: 0,
      sort: 'recent'
    })
  })

  it('says so when there are no hashtags', async () => {
    getAllHashtags.mockResolvedValue({ hashtags: [], total: 0 })

    await renderPage()

    expect(screen.getByText('No hashtags found')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('keeps the offset of a huge page number in the safe-integer range', async () => {
    getAllHashtags.mockResolvedValue({ hashtags: [], total: 0 })

    await renderPage({ page: '100000000000000000000' })

    // 1e21 as a bound parameter makes SQLite and PostgreSQL throw.
    expect(getAllHashtags).toHaveBeenCalledWith({
      limit: 20,
      offset: Number.MAX_SAFE_INTEGER,
      sort: 'alphabetical'
    })
  })

  it('pages under the table and keeps the sort in the links', async () => {
    getAllHashtags.mockResolvedValue({
      hashtags: [hashtag('#a', 1)],
      total: 45
    })

    await renderPage({ sort: 'count', page: '2' })

    expect(getAllHashtags).toHaveBeenCalledWith({
      limit: 20,
      offset: 20,
      sort: 'count'
    })
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Next/ })).toHaveAttribute(
      'href',
      '/admin/tags?sort=count&page=3'
    )
  })

  it('switches to loading skeleton on sort tab click until new props arrive', async () => {
    getAllHashtags.mockResolvedValue({
      hashtags: [hashtag('#fediverse', 12, Date.UTC(2026, 9, 1, 8, 30))],
      total: 1
    })

    const { rerender } = await renderPage()

    expect(screen.getByRole('table', { name: 'Hashtags' })).toBeInTheDocument()
    const recentLink = screen.getByRole('link', { name: 'Recently active' })
    expect(recentLink).not.toHaveAttribute('aria-current')

    fireEvent.click(recentLink)

    expect(recentLink).toHaveAttribute('aria-current', 'page')
    expect(
      screen.queryByRole('table', { name: 'Hashtags' })
    ).not.toBeInTheDocument()
    const skeleton = screen.getByRole('status')
    expect(skeleton).toHaveTextContent('Loading hashtags')
    expect(
      skeleton.querySelectorAll('[data-slot="skeleton-bar"]').length
    ).toBeGreaterThan(0)

    getAllHashtags.mockResolvedValue({
      hashtags: [hashtag('#recenttag', 5, Date.UTC(2026, 9, 2, 8, 30))],
      total: 1
    })
    rerender(await Page({ searchParams: Promise.resolve({ sort: 'recent' }) }))

    expect(screen.getByRole('table', { name: 'Hashtags' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Recently active' })
    ).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'recenttag' })).toBeInTheDocument()

    // Simulating browser Back navigation: re-render with previous sort without a link click
    getAllHashtags.mockResolvedValue({
      hashtags: [hashtag('#fediverse', 12, Date.UTC(2026, 9, 1, 8, 30))],
      total: 1
    })
    rerender(
      await Page({ searchParams: Promise.resolve({ sort: 'alphabetical' }) })
    )

    expect(screen.getByRole('table', { name: 'Hashtags' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Alphabetical' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByRole('link', { name: 'fediverse' })).toBeInTheDocument()
  })

  it('switches to loading skeleton and advances page label on pagination click until new props arrive', async () => {
    getAllHashtags.mockResolvedValue({
      hashtags: [hashtag('#tag1', 10)],
      total: 45
    })

    const { rerender } = await renderPage({ page: '1' })

    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    const nextLink = screen.getByRole('link', { name: /Next/ })
    expect(nextLink).toBeInTheDocument()

    fireEvent.click(nextLink)

    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Next/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled()

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    const skeleton = screen.getByRole('status')
    expect(skeleton).toHaveTextContent('Loading hashtags')
    expect(
      skeleton.querySelectorAll('[data-slot="skeleton-bar"]').length
    ).toBeGreaterThan(0)

    getAllHashtags.mockResolvedValue({
      hashtags: [hashtag('#tag21', 5)],
      total: 45
    })
    rerender(await Page({ searchParams: Promise.resolve({ page: '2' }) }))

    expect(screen.getByRole('table', { name: 'Hashtags' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Next/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Previous/ })).toBeInTheDocument()
  })
})
