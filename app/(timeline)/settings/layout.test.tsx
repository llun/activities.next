/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'
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

  it('groups the rail under Preferences and Privacy & safety, in order', async () => {
    await renderLayout('/settings/appearance')

    const nav = screen.getByRole('navigation', { name: 'Settings' })
    const names = (group: string) =>
      within(within(nav).getByRole('group', { name: group }))
        .getAllByRole('link')
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

    const links = within(nav).getAllByRole('link')
    expect(links[0]).toHaveAttribute('href', '/settings/profile')
    expect(links[0]).toHaveTextContent('Edit profile@anna@llun.test')
    expect(
      within(nav).getByRole('link', { name: 'Delete this profile' })
    ).toHaveAttribute('href', '/settings/delete')
    expect(
      within(nav).getByRole('link', { name: /Account & security/ })
    ).toHaveAttribute('href', '/account')
    // No "General" any more, and no dropdown.
    expect(within(nav).queryByText('General')).not.toBeInTheDocument()
    expect(within(nav).queryByRole('button')).not.toBeInTheDocument()
  })

  it('lists Moving just before Delete this profile', async () => {
    await renderLayout('/settings/moving')

    const nav = screen.getByRole('navigation', { name: 'Settings' })
    const links = within(nav).getAllByRole('link')
    const moving = links.find((link) => link.textContent?.startsWith('Moving'))
    expect(moving).toHaveAttribute('href', '/settings/moving')
    expect(moving).toHaveTextContent('Moving')
    // Moving sits in the ungrouped footer list, directly above the delete row.
    const movingIndex = links.indexOf(moving!)
    expect(links[movingIndex + 1]).toHaveTextContent(/^Delete this profile/)
  })

  it.each([
    ['/settings/preferences', 'Posting & reading'],
    ['/settings/sidebar', 'Sidebar'],
    ['/settings/profile', 'Edit profile@anna@llun.test'],
    ['/settings/moving', 'Moving']
  ])('marks %s current as %s', async (pathname, name) => {
    await renderLayout(pathname)

    const nav = screen.getByRole('navigation', { name: 'Settings' })
    const current = within(nav)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveTextContent(name)
  })

  it('leads a section page with Back to Settings below lg', async () => {
    await renderLayout('/settings/privacy')

    const back = screen.getByRole('link', { name: 'Back to settings' })
    expect(back).toHaveAttribute('href', '/settings')
    expect(back).toHaveClass('lg:hidden')
  })

  it('renders the index list instead of the rail on /settings', async () => {
    await renderLayout('/settings')

    expect(
      screen.queryByRole('navigation', { name: 'Settings' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Back to settings' })
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
