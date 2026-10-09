/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

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
})
