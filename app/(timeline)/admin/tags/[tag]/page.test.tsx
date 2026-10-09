/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

import Page from './page'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ host: 'llun.test' }))
}))

const getHashtagStatusesPage = vi.fn()

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => ({ getHashtagStatusesPage }))
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
  notFound: vi.fn(() => {
    throw new Error('Unexpected notFound')
  }),
  redirect: vi.fn((path: string) => {
    throw new Error(`Unexpected redirect to ${path}`)
  })
}))

vi.mock('./AdminHashtagPosts', () => ({
  AdminHashtagPosts: ({ statuses }: { statuses: unknown[] }) => (
    <div data-testid="posts">{statuses.length}</div>
  )
}))

const renderPage = async (searchParams: Record<string, string> = {}) =>
  render(
    await Page({
      params: Promise.resolve({ tag: 'fediverse' }),
      searchParams: Promise.resolve(searchParams)
    })
  )

// The value beside a key fact's label in the header block.
const factOf = (label: string) =>
  within(screen.getByText(label).parentElement!).getByRole('definition')

describe('/admin/tags/[tag]', () => {
  beforeEach(() => {
    getHashtagStatusesPage.mockResolvedValue({ statuses: [], total: 0 })
  })

  it('says so when no public post uses the hashtag', async () => {
    await renderPage()

    expect(
      screen.getByText('No public posts with #fediverse')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('posts')).not.toBeInTheDocument()
  })

  it('shows the posts and pages under them', async () => {
    getHashtagStatusesPage.mockResolvedValue({
      statuses: [{ id: 's1' }, { id: 's2' }],
      total: 45
    })

    await renderPage({ page: '2' })

    expect(getHashtagStatusesPage).toHaveBeenCalledWith({
      hashtag: 'fediverse',
      limit: 20,
      offset: 20
    })
    expect(screen.getByTestId('posts')).toHaveTextContent('2')
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Previous/ })).toHaveAttribute(
      'href',
      '/admin/tags/fediverse?page=1'
    )
  })

  it('opens with the key facts: how many posts, which ones and the latest', async () => {
    getHashtagStatusesPage.mockResolvedValue({
      statuses: [
        { id: 's2', createdAt: Date.UTC(2026, 8, 20, 12) },
        { id: 's1', createdAt: Date.UTC(2026, 8, 3, 9) }
      ],
      total: 1234
    })

    await renderPage()

    expect(factOf('Public posts')).toHaveTextContent('1,234')
    expect(factOf('Showing')).toHaveTextContent('1–2')
    expect(factOf('Latest post')).toHaveTextContent('2026-09-20')
  })

  it('calls the date the newest of the page once it is not the first page', async () => {
    getHashtagStatusesPage.mockResolvedValue({
      statuses: [{ id: 's21', createdAt: Date.UTC(2026, 7, 1, 12) }],
      total: 45
    })

    await renderPage({ page: '2' })

    expect(screen.queryByText('Latest post')).not.toBeInTheDocument()
    expect(factOf('Newest on this page')).toHaveTextContent('2026-08-01')
    expect(factOf('Showing')).toHaveTextContent('21–21')
  })

  it('has only the post count to show when no public post uses the hashtag', async () => {
    await renderPage()

    expect(screen.getByText('Public posts')).toBeInTheDocument()
    expect(screen.queryByText('Showing')).not.toBeInTheDocument()
    expect(screen.queryByText('Latest post')).not.toBeInTheDocument()
  })

  it('puts a "Back" to the hashtags list beside the tag heading', async () => {
    render(
      await Page({
        params: Promise.resolve({ tag: 'fediverse' }),
        searchParams: Promise.resolve({})
      })
    )

    const back = screen.getByRole('link', { name: 'Back to hashtags list' })
    expect(back).toHaveAttribute('href', '/admin/tags')
    expect(within(back).getByText('Back')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 1, name: 'fediverse' })
    ).not.toContainElement(back)
  })
})
