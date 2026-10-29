/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
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

// Radix hides everything outside an open menu from the accessibility tree, so
// read the row (the link and the trigger) before this.
const openMenu = async () => {
  const nav = screen.getByRole('navigation', { name: 'Admin' })
  fireEvent.keyDown(within(nav).getByRole('button'), { key: 'ArrowDown' })
  return screen.findByRole('menu')
}

const triggerText = () =>
  within(screen.getByRole('navigation', { name: 'Admin' })).getByRole('button')
    .textContent

const activeItemsIn = (scope: HTMLElement) =>
  within(scope)
    .getAllByRole('menuitem')
    .filter((item) => item.getAttribute('aria-current') === 'page')

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

  it('lists the four groups in order in the menu, with item hrefs', async () => {
    await renderAt('/admin/reports')

    const menu = await openMenu()
    // The five headed groups, Overview first.
    expect(
      within(menu)
        .getAllByRole('group')
        .map(
          (group) =>
            document.getElementById(group.getAttribute('aria-labelledby')!)
              ?.textContent
        )
    ).toEqual(['Overview', 'Moderation', 'Community', 'Server', 'Maintenance'])

    // The name span alone, so the badge's screen reader text does not pollute
    // Reports.
    const items = within(menu).getAllByRole('menuitem')
    expect(
      items.map((item) => [
        item.querySelector('.truncate')?.textContent,
        item.getAttribute('href')
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

    expect(triggerText()).toBe('Dashboard')
    const active = activeItemsIn(await openMenu())
    expect(active).toHaveLength(1)
    expect(active[0]).toHaveTextContent('Dashboard')
    expect(active[0]).toHaveAttribute('href', '/admin/overview')
  })

  it('marks Reports active at a nested path like /admin/reports/123', async () => {
    await renderAt('/admin/reports/123')

    expect(triggerText()).toBe('Reports')
    const active = activeItemsIn(await openMenu())
    expect(active).toHaveLength(1)
    expect(active[0]).toHaveTextContent('Reports')
    expect(active[0]).toHaveAttribute('href', '/admin/reports')
  })

  it('marks Served domains active at a nested path like /admin/domains/example.com', async () => {
    await renderAt('/admin/domains/example.com')

    expect(triggerText()).toBe('Served domains')
    const active = activeItemsIn(await openMenu())
    expect(active).toHaveLength(1)
    expect(active[0]).toHaveTextContent('Served domains')
    expect(active[0]).toHaveAttribute('href', '/admin/domains')
  })

  it('renders the grouped index at /admin: no dropdown row, one card run per group', async () => {
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

  it('renders the grouped index in one column: Overview first, then Moderation, Community, Server and Maintenance', async () => {
    await renderAt('/admin')

    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent)
    expect(headings).toEqual([
      'Overview',
      'Moderation',
      'Community',
      'Server',
      'Maintenance'
    ])
    // The headless Dashboard group lists its item without a heading.
    expect(screen.getByRole('link', { name: /Dashboard/ })).toHaveAttribute(
      'href',
      '/admin/overview'
    )
  })

  it('renders the Admin link and no Back row on item and detail pages', async () => {
    const { unmount } = await renderAt('/admin/reports')
    // jsdom drops the space before the visually hidden suffix (a browser
    // keeps it), hence `\s*`.
    expect(
      screen.getByRole('link', { name: /^Admin\s*\(all pages\)$/ })
    ).toHaveAttribute('href', '/admin')
    expect(
      screen.queryByRole('link', { name: /^Back to admin/ })
    ).not.toBeInTheDocument()
    unmount()

    await renderAt('/admin/reports/123')
    expect(
      screen.getByRole('link', { name: /^Admin\s*\(all pages\)$/ })
    ).toHaveAttribute('href', '/admin')
    expect(triggerText()).toBe('Reports')
    expect(
      screen.queryByRole('link', { name: /^Back to admin/ })
    ).not.toBeInTheDocument()
  })

  it('renders exactly one section navigation, the dropdown row', async () => {
    const { container } = await renderAt('/admin/reports/123')

    const navs = screen.getAllByRole('navigation', { name: 'Admin' })
    expect(navs).toHaveLength(1)
    expect(within(navs[0]).getAllByRole('button')).toHaveLength(1)
    expect(container.querySelector('.max-lg\\:hidden')).toBeNull()
  })

  it('shows the open report count on the Reports row and the index, not on the trigger', async () => {
    const { unmount } = await renderAt('/admin/reports')

    expect(countOpenReports).toHaveBeenCalledWith({ limit: 100 })
    expect(triggerText()).toBe('Reports')
    const menu = await openMenu()
    expect(
      within(menu).getByRole('menuitem', {
        name: /Reports\s*\(4 unresolved reports\)/
      })
    ).toBeInTheDocument()

    unmount()
    await renderAt('/admin')

    expect(
      screen.getByRole('link', { name: /Reports.*4 unresolved reports/ })
    ).toBeInTheDocument()
    expect(countOpenReports).toHaveBeenCalledTimes(2)
  })

  it('uses the singular for one open report', async () => {
    countOpenReports.mockResolvedValue(1)
    await renderAt('/admin/reports')

    const menu = await openMenu()
    expect(
      within(menu).getByRole('menuitem', {
        name: /Reports\s*\(1 unresolved report\)/
      })
    ).toBeInTheDocument()
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

    const menu = await openMenu()
    const reports = within(menu).getByRole('menuitem', { name: 'Reports' })
    expect(within(reports).queryByText(/^\d+$/)).not.toBeInTheDocument()
  })
})
