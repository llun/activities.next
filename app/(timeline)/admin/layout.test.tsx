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

const getDropdownNav = () => {
  const navs = screen.getAllByRole('navigation', { name: 'Admin' })
  const dropdown = navs.find((nav) =>
    nav.parentElement?.classList.contains('lg:hidden')
  )
  expect(dropdown).toBeDefined()
  return dropdown!
}

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

  it('renders the rail navigation from lg up listing all 16 items in order with their hrefs', () => {
    renderAt('/admin')

    const rail = getRailNav()
    expect(rail).toHaveClass('max-lg:hidden')

    const links = within(rail).getAllByRole('link')
    expect(links).toHaveLength(16)
    expect(
      links.map((link) => [link.textContent, link.getAttribute('href')])
    ).toEqual([
      ['Overview', '/admin'],
      ['Accounts', '/admin/accounts'],
      ['Reports', '/admin/reports'],
      ['Server rules', '/admin/rules'],
      ['Hashtags', '/admin/tags'],
      ['Announcements', '/admin/announcements'],
      ['Filters', '/admin/filters'],
      ['Custom emojis', '/admin/emojis'],
      ['Federation', '/admin/federation'],
      ['Relays', '/admin/relays'],
      ['Domains', '/admin/domains'],
      ['Posts & media', '/admin/posts'],
      ['Network', '/admin/network'],
      ['Instance', '/admin/instance'],
      ['Queues', '/admin/queues'],
      ['System', '/admin/system']
    ])
  })

  it('marks only Overview as active in the rail when at /admin', () => {
    renderAt('/admin')

    const rail = getRailNav()
    const activeLinks = within(rail)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')

    expect(activeLinks).toHaveLength(1)
    expect(activeLinks[0]).toHaveTextContent('Overview')
    expect(activeLinks[0]).toHaveAttribute('href', '/admin')
  })

  it('marks Reports as active in the rail when at a nested path like /admin/reports/123', () => {
    renderAt('/admin/reports/123')

    const rail = getRailNav()
    const activeLinks = within(rail)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')

    expect(activeLinks).toHaveLength(1)
    expect(activeLinks[0]).toHaveTextContent('Reports')
    expect(activeLinks[0]).toHaveAttribute('href', '/admin/reports')
  })

  it('renders the dropdown inside an lg:hidden wrapper and displays the active tab name on the trigger', () => {
    renderAt('/admin/reports/123')

    const dropdown = getDropdownNav()
    expect(dropdown.parentElement).toHaveClass('lg:hidden')

    const trigger = within(dropdown).getByRole('button')
    expect(trigger).toHaveTextContent('Reports')
  })

  it('shows Overview on the dropdown trigger when on /admin', () => {
    renderAt('/admin')

    const dropdown = getDropdownNav()
    expect(dropdown.parentElement).toHaveClass('lg:hidden')

    const trigger = within(dropdown).getByRole('button')
    expect(trigger).toHaveTextContent('Overview')
  })

  it('does not render a "Back to" link because Admin has no indexUrl and uses mobileNav', () => {
    renderAt('/admin/reports')

    expect(
      screen.queryByRole('link', { name: /^Back to/i })
    ).not.toBeInTheDocument()

    renderAt('/admin')

    expect(
      screen.queryByRole('link', { name: /^Back to/i })
    ).not.toBeInTheDocument()
  })
})
