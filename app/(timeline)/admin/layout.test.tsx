/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'
import { usePathname } from 'next/navigation'

import Layout from './layout'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn()
}))

const renderAt = (pathname: string) => {
  vi.mocked(usePathname).mockReturnValue(pathname)
  return render(
    <Layout>
      <div>content</div>
    </Layout>
  )
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
  it('renders the header title and description', () => {
    renderAt('/admin')

    expect(
      screen.getByRole('heading', { level: 1, name: 'Admin' })
    ).toBeInTheDocument()
    expect(
      screen.getByText('Moderate accounts, reports, and instance settings')
    ).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('lists the five groups in order in the rail, with item hrefs', () => {
    renderAt('/admin/reports')

    const rail = getRailNav()
    // The headless first run holds Dashboard; the four headed groups follow.
    expect(
      within(rail)
        .getAllByRole('group')
        .map((group) => group.querySelector('p')?.textContent)
    ).toEqual(['Moderation', 'Community', 'Server', 'Maintenance'])

    const links = within(rail).getAllByRole('link')
    expect(
      links.map((link) => [link.textContent, link.getAttribute('href')])
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

  it('marks Dashboard active at /admin/overview', () => {
    renderAt('/admin/overview')

    const active = activeLinksIn(getRailNav())
    expect(active).toHaveLength(1)
    expect(active[0]).toHaveTextContent('Dashboard')
    expect(active[0]).toHaveAttribute('href', '/admin/overview')
  })

  it('marks Reports active at a nested path like /admin/reports/123', () => {
    renderAt('/admin/reports/123')

    const active = activeLinksIn(getRailNav())
    expect(active).toHaveLength(1)
    expect(active[0]).toHaveTextContent('Reports')
    expect(active[0]).toHaveAttribute('href', '/admin/reports')
  })

  it('marks Served domains active at a nested path like /admin/domains/example.com', () => {
    renderAt('/admin/domains/example.com')

    const active = activeLinksIn(getRailNav())
    expect(active).toHaveLength(1)
    expect(active[0]).toHaveTextContent('Served domains')
    expect(active[0]).toHaveAttribute('href', '/admin/domains')
  })

  it('renders the grouped index at /admin: no rail, one card run per group', () => {
    renderAt('/admin')

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

  it('shows a "Back to admin" row below lg on direct item pages but not on detail pages', () => {
    const { unmount } = renderAt('/admin/reports')
    expect(screen.getByRole('link', { name: 'Back to admin' })).toHaveAttribute(
      'href',
      '/admin'
    )
    unmount()

    renderAt('/admin/reports/123')
    expect(
      screen.queryByRole('link', { name: 'Back to admin' })
    ).not.toBeInTheDocument()
  })

  it('renders no dropdown navigation', () => {
    renderAt('/admin/reports/123')

    // Only the rail carries the section's name.
    const navs = screen.getAllByRole('navigation', { name: 'Admin' })
    expect(navs).toHaveLength(1)
    expect(navs[0]).toHaveClass('max-lg:hidden')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
