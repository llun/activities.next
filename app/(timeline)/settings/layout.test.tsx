/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { usePathname } from 'next/navigation'

import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import Layout from './layout'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn()
}))

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => ({}))
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({
    user: { email: 'anna@llun.test' }
  })
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: vi.fn().mockResolvedValue({
    id: 'https://llun.test/users/anna',
    username: 'anna',
    domain: 'llun.test',
    iconUrl: null
  })
}))

const renderLayout = async (pathname: string) => {
  ;(usePathname as jest.Mock).mockReturnValue(pathname)
  render(
    await Layout({
      children: <div>content</div>
    })
  )
}

const openMenu = async () => {
  const nav = screen.getByRole('navigation', { name: 'Settings' })
  fireEvent.keyDown(within(nav).getByRole('button'), { key: 'ArrowDown' })
  return screen.findByRole('menu')
}

describe('Settings Layout', () => {
  it('names the profile the settings are for in the section header', async () => {
    await renderLayout('/settings/appearance')

    expect(
      screen.getByRole('heading', { level: 1, name: 'Settings' })
    ).toBeInTheDocument()
    expect(screen.getByText('For @anna@llun.test')).toBeInTheDocument()
  })

  it('renders Settings title without profile subtitle when signed out', async () => {
    vi.mocked(getActorFromSession).mockResolvedValueOnce(null as never)
    await renderLayout('/settings/appearance')

    expect(
      screen.getByRole('heading', { level: 1, name: 'Settings' })
    ).toBeInTheDocument()
    expect(screen.queryByText(/^For /)).not.toBeInTheDocument()
  })

  it('groups the menu under Preferences and Privacy & safety, in order', async () => {
    await renderLayout('/settings/appearance')
    const menu = await openMenu()

    const names = (group: string) =>
      within(within(menu).getByRole('group', { name: group }))
        .getAllByRole('menuitem')
        .map((link) => link.textContent)
    expect(names('Preferences')).toEqual([
      'Appearance',
      'Posting & reading',
      'Notifications',
      'Sidebar',
      'Media & AI'
    ])
    expect(names('Privacy & safety')).toEqual([
      'Privacy',
      'Blocked accounts',
      'Muted accounts',
      'Filters'
    ])

    // Edit profile leads the menu and no longer carries the handle.
    const items = within(menu).getAllByRole('menuitem')
    expect(items[0]).toHaveAttribute('href', '/settings/profile')
    expect(items[0]).toHaveTextContent('Edit profile')
    expect(items[0]).not.toHaveTextContent('@anna@llun.test')
    expect(
      within(menu).getByRole('menuitem', { name: 'Delete this profile' })
    ).toHaveAttribute('href', '/settings/delete')
    const account = within(menu).getByRole('menuitem', {
      name: 'Account & security'
    })
    expect(account).toHaveAttribute('href', '/account')
    expect(
      within(menu).queryByText('Shared across your profiles')
    ).not.toBeInTheDocument()
    // No "General" any more.
    expect(within(menu).queryByText('General')).not.toBeInTheDocument()
  })

  it('lists Moving just before Delete this profile', async () => {
    await renderLayout('/settings/moving')
    const menu = await openMenu()

    const items = within(menu).getAllByRole('menuitem')
    const moving = items.find((item) => item.textContent === 'Moving')
    expect(moving).toHaveAttribute('href', '/settings/moving')
    // Moving sits in the after-footer run, directly above the delete row.
    expect(items[items.indexOf(moving!) + 1]).toHaveTextContent(
      /^Delete this profile/
    )
  })

  it.each([
    ['/settings/preferences', 'Posting & reading'],
    ['/settings/sidebar', 'Sidebar'],
    ['/settings/profile', 'Edit profile'],
    ['/settings/moving', 'Moving']
  ])('marks %s current as %s', async (pathname, name) => {
    await renderLayout(pathname)

    const nav = screen.getByRole('navigation', { name: 'Settings' })
    expect(within(nav).getByRole('button')).toHaveTextContent(name)

    const menu = await openMenu()
    const current = within(menu)
      .getAllByRole('menuitem')
      .filter((item) => item.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveTextContent(name)
  })

  it('renders the Settings link and no Back row on a section page', async () => {
    await renderLayout('/settings/privacy')

    // jsdom drops the space before the visually hidden suffix (a browser
    // keeps it), hence `\s*`.
    expect(
      screen.getByRole('link', { name: /^Settings\s*\(all pages\)$/ })
    ).toHaveAttribute('href', '/settings')
    expect(
      screen.queryByRole('link', { name: /^Back to/ })
    ).not.toBeInTheDocument()
  })

  it('renders the index list and no dropdown row on /settings', async () => {
    await renderLayout('/settings')

    expect(
      screen.queryByRole('navigation', { name: 'Settings' })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /all pages/ })
    ).not.toBeInTheDocument()
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    ).toEqual([
      'Preferences',
      'Privacy & safety',
      'Shared across your profiles'
    ])
    expect(
      screen.getByText('Remove @anna and its posts from this server')
    ).toBeInTheDocument()
    // The index rows carry each section's description.
    expect(screen.getByRole('link', { name: /Moving/ })).toHaveAttribute(
      'href',
      '/settings/moving'
    )
    expect(
      screen.getByText('Change your handle, or move to another account')
    ).toBeInTheDocument()
    // Edit profile is the page's own card on the index, not a list row.
    expect(
      screen.queryByRole('link', { name: /Edit profile/ })
    ).not.toBeInTheDocument()
  })
})
