/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'
import { usePathname } from 'next/navigation'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

import Layout from './layout'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn()
}))

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn()
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn()
}))

vi.mock('@/lib/utils/getAdminFromSession', () => ({
  getAdminFromSession: vi.fn()
}))

const countOpenReports = vi.fn()
const database = { countOpenReports }
const session = { user: { id: 'admin' } } as never

beforeEach(() => {
  vi.clearAllMocks()
  countOpenReports.mockReset()
  countOpenReports.mockResolvedValue(4)
  vi.mocked(getDatabase).mockReturnValue(database as never)
  vi.mocked(getServerAuthSession).mockResolvedValue(session)
  vi.mocked(getAdminFromSession).mockResolvedValue({} as never)
})

const renderAt = async (pathname: string) => {
  vi.mocked(usePathname).mockReturnValue(pathname)
  return render(await Layout({ children: <div>content</div> }))
}

const getRailNav = () => {
  const navs = screen.getAllByRole('navigation', { name: 'Admin' })
  const rail = navs.find((nav) => nav.classList.contains('max-lg:hidden'))
  expect(rail).toBeDefined()
  return rail!
}

const activeLinksIn = (scope: HTMLElement) =>
  within(scope)
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')

describe('Admin Layout', () => {
  it('renders the header title and description', async () => {
    await renderAt('/admin')

    expect(
      screen.getByRole('heading', { level: 1, name: 'Admin' })
    ).toBeInTheDocument()
    expect(
      screen.getByText('Moderate accounts, reports, and server settings')
    ).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('lists the five groups in order in the rail, with item hrefs', async () => {
    await renderAt('/admin/reports')

    const rail = getRailNav()
    // The headless first run holds Dashboard; the four headed groups follow.
    expect(
      within(rail)
        .getAllByRole('group')
        .map((group) => group.querySelector('p')?.textContent)
    ).toEqual(['Moderation', 'Community', 'Server', 'Maintenance'])

    const links = within(rail).getAllByRole('link')
    expect(
      links.map((link) => [
        link.querySelector('.min-w-0 > span')?.textContent,
        link.getAttribute('href')
      ])
    ).toEqual([
      ['Dashboard', '/admin/overview'],
      ['Reports', '/admin/reports'],
      ['Accounts', '/admin/accounts'],
      ['Hashtags', '/admin/tags'],
      ['Server filters', '/admin/filters'],
      ['Federation', '/admin/federation'],
      ['Announcements', '/admin/announcements'],
      ['Custom emojis', '/admin/emojis'],
      ['Server settings', '/admin/instance'],
      ['Server rules', '/admin/rules'],
      ['Posts & media', '/admin/posts'],
      ['Network', '/admin/network'],
      ['Served domains', '/admin/domains'],
      ['Relays', '/admin/relays'],
      ['Queues', '/admin/queues'],
      ['System', '/admin/system']
    ])
  })

  it('marks Dashboard active at /admin/overview', async () => {
    await renderAt('/admin/overview')

    const active = activeLinksIn(getRailNav())
    expect(active).toHaveLength(1)
    expect(active[0]).toHaveTextContent('Dashboard')
    expect(active[0]).toHaveAttribute('href', '/admin/overview')
  })

  it('marks Reports active at a nested path like /admin/reports/123', async () => {
    await renderAt('/admin/reports/123')

    const active = activeLinksIn(getRailNav())
    expect(active).toHaveLength(1)
    expect(active[0]).toHaveTextContent('Reports')
    expect(active[0]).toHaveAttribute('href', '/admin/reports')
  })

  it('marks Served domains active at a nested path like /admin/domains/example.com', async () => {
    await renderAt('/admin/domains/example.com')

    const active = activeLinksIn(getRailNav())
    expect(active).toHaveLength(1)
    expect(active[0]).toHaveTextContent('Served domains')
    expect(active[0]).toHaveAttribute('href', '/admin/domains')
  })

  it('renders the grouped index at /admin: no rail, one card run per group', async () => {
    await renderAt('/admin')

    expect(
      screen.queryByRole('navigation', { name: 'Admin' })
    ).not.toBeInTheDocument()

    for (const heading of [
      'Moderation',
      'Community',
      'Server',
      'Maintenance'
    ]) {
      expect(
        screen.getByRole('heading', { level: 2, name: heading })
      ).toBeInTheDocument()
    }
    // The headless Dashboard group lists its item without a heading.
    expect(screen.getByRole('link', { name: /Dashboard/ })).toHaveAttribute(
      'href',
      '/admin/overview'
    )
  })

  it('splits the grouped index: Dashboard, Moderation and Community left; Server and Maintenance right', async () => {
    await renderAt('/admin')

    const grid = screen
      .getByRole('heading', { level: 2, name: 'Moderation' })
      .closest('.grid')!
    const columns = Array.from(grid.children).map((column) =>
      Array.from(column.querySelectorAll('h2')).map((h) => h.textContent)
    )
    expect(columns).toEqual([
      ['Moderation', 'Community'],
      ['Server', 'Maintenance']
    ])
    // The headless Dashboard run leads the left column without a heading.
    expect(
      within(grid.children[0] as HTMLElement).getByRole('link', {
        name: /Dashboard/
      })
    ).toHaveAttribute('href', '/admin/overview')
    expect(
      within(grid.children[1] as HTMLElement).queryByRole('link', {
        name: /Dashboard/
      })
    ).toBeNull()
  })

  it('shows a "Back to admin" row below lg on direct item pages but not on detail pages', async () => {
    const { unmount } = await renderAt('/admin/reports')
    expect(screen.getByRole('link', { name: 'Back to admin' })).toHaveAttribute(
      'href',
      '/admin'
    )
    unmount()

    await renderAt('/admin/reports/123')
    expect(
      screen.queryByRole('link', { name: 'Back to admin' })
    ).not.toBeInTheDocument()
  })

  it('renders no dropdown navigation', async () => {
    await renderAt('/admin/reports/123')

    // Only the rail carries the section's name.
    const navs = screen.getAllByRole('navigation', { name: 'Admin' })
    expect(navs).toHaveLength(1)
    expect(navs[0]).toHaveClass('max-lg:hidden')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows the open report count in the rail and index for admins', async () => {
    const { unmount } = await renderAt('/admin/reports')

    expect(countOpenReports).toHaveBeenCalledWith({ limit: 100 })
    expect(
      screen.getByRole('link', { name: /Reports\s*\(4 unresolved reports\)/ })
    ).toBeInTheDocument()

    unmount()
    await renderAt('/admin')

    expect(
      screen.getByRole('link', { name: /Reports.*4 unresolved reports/ })
    ).toBeInTheDocument()
    expect(countOpenReports).toHaveBeenCalledTimes(2)
  })

  it('does not count reports for a non-admin viewer', async () => {
    vi.mocked(getAdminFromSession).mockResolvedValue(null)
    await renderAt('/admin')

    expect(getAdminFromSession).toHaveBeenCalledWith(database, session)
    expect(countOpenReports).not.toHaveBeenCalled()
    expect(screen.getByText('content')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Reports/ })).toBeInTheDocument()
  })

  it('renders without counting reports when the database is unavailable', async () => {
    vi.mocked(getDatabase).mockReturnValue(null as never)
    await renderAt('/admin/reports')

    expect(screen.getByText('content')).toBeInTheDocument()
    expect(getServerAuthSession).not.toHaveBeenCalled()
    expect(getAdminFromSession).not.toHaveBeenCalled()
    expect(countOpenReports).not.toHaveBeenCalled()

    const reports = screen.getByRole('link', { name: 'Reports' })
    expect(within(reports).queryByText(/^\d+$/)).not.toBeInTheDocument()
  })
})
