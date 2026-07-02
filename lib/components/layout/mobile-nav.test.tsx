/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { usePathname } from 'next/navigation'
import { ReactElement } from 'react'

import { MobileNav } from '@/lib/components/layout/mobile-nav'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn()
}))

const renderMobileNav = (ui: ReactElement) => render(ui)

describe('MobileNav', () => {
  beforeEach(() => {
    ;(usePathname as jest.Mock).mockReturnValue('/settings')
  })

  it('keeps extra navigation items accessible from the overflow menu', async () => {
    renderMobileNav(<MobileNav fitnessUrl="/@llun@llun.test/fitness" isAdmin />)

    const nav = screen.getByRole('navigation')
    // The bottom bar uses compact labels: Timeline -> Home, Notifications ->
    // Alerts (see NavItem.shortLabel).
    expect(within(nav).getByRole('link', { name: /home/i })).toHaveAttribute(
      'href',
      '/'
    )
    expect(within(nav).getByRole('link', { name: /search/i })).toHaveAttribute(
      'href',
      '/search'
    )
    expect(
      within(nav).getByRole('link', { name: /messages/i })
    ).toHaveAttribute('href', '/messages')
    expect(within(nav).getByRole('link', { name: /alerts/i })).toHaveAttribute(
      'href',
      '/notifications'
    )
    expect(
      within(nav).queryByRole('link', { name: /bookmarks/i })
    ).not.toBeInTheDocument()
    expect(
      within(nav).queryByRole('link', { name: /fitness/i })
    ).not.toBeInTheDocument()
    expect(
      within(nav).queryByRole('link', { name: /admin/i })
    ).not.toBeInTheDocument()
    expect(
      within(nav).queryByRole('link', { name: /settings/i })
    ).not.toBeInTheDocument()

    fireEvent.keyDown(
      within(nav).getByRole('button', { name: 'More navigation' }),
      { key: 'ArrowDown' }
    )

    expect(
      await screen.findByRole('menuitem', { name: /bookmarks/i })
    ).toHaveAttribute('href', '/bookmarks')
    expect(screen.getByRole('menuitem', { name: /fitness/i })).toHaveAttribute(
      'href',
      '/@llun@llun.test/fitness'
    )
    expect(screen.getByRole('menuitem', { name: /admin/i })).toHaveAttribute(
      'href',
      '/admin'
    )
    expect(screen.getByRole('menuitem', { name: /account/i })).toHaveAttribute(
      'href',
      '/account'
    )
    expect(screen.getByRole('menuitem', { name: /settings/i })).toHaveAttribute(
      'href',
      '/settings'
    )
  })

  it('uses compact labels (Home, Alerts) for the bottom-bar direct items', () => {
    renderMobileNav(<MobileNav />)

    const nav = screen.getByRole('navigation')
    expect(within(nav).getByText('Home')).toBeInTheDocument()
    expect(within(nav).getByText('Alerts')).toBeInTheDocument()
    // The full desktop labels must not leak into the compact bottom bar.
    expect(within(nav).queryByText('Timeline')).not.toBeInTheDocument()
    expect(within(nav).queryByText('Notifications')).not.toBeInTheDocument()
  })

  it('orders Profile before account entries in the overflow menu', async () => {
    renderMobileNav(
      <MobileNav
        fitnessUrl="/@llun@llun.test/fitness"
        profileUrl="/@llun@llun.test"
        isAdmin
      />
    )

    fireEvent.keyDown(screen.getByRole('button', { name: 'More navigation' }), {
      key: 'ArrowDown'
    })

    const items = await screen.findAllByRole('menuitem')
    const names = items.map((item) => item.textContent?.trim())
    // Design-system overflow order: Explore, Favorites, Bookmarks, Lists,
    // Fitness, Profile, Admin, Account, Settings. (Search is a direct bottom-bar
    // item, so its neighbour Explore leads the overflow.)
    expect(names).toEqual([
      'Explore',
      'Favorites',
      'Bookmarks',
      'Lists',
      'Fitness',
      'Profile',
      'Admin',
      'Account',
      'Settings'
    ])
  })

  it('places Profile before Admin in the overflow menu (no fitness)', async () => {
    renderMobileNav(<MobileNav profileUrl="/@llun@llun.test" isAdmin />)

    fireEvent.keyDown(screen.getByRole('button', { name: 'More navigation' }), {
      key: 'ArrowDown'
    })

    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      'Explore',
      'Favorites',
      'Bookmarks',
      'Lists',
      'Profile',
      'Admin',
      'Account',
      'Settings'
    ])
  })

  it('places Profile before Account in the overflow menu (no admin)', async () => {
    renderMobileNav(<MobileNav profileUrl="/@llun@llun.test" />)

    fireEvent.keyDown(screen.getByRole('button', { name: 'More navigation' }), {
      key: 'ArrowDown'
    })

    const items = await screen.findAllByRole('menuitem')
    // No Admin entry, so Profile anchors directly before Account (the first of
    // the account-level cluster).
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      'Explore',
      'Favorites',
      'Bookmarks',
      'Lists',
      'Profile',
      'Account',
      'Settings'
    ])
  })

  it('adds a Profile entry to the overflow menu when profileUrl is provided', async () => {
    renderMobileNav(<MobileNav profileUrl="/@llun@llun.test" />)

    const nav = screen.getByRole('navigation')
    // Profile lives in the overflow, never as a direct item.
    expect(
      within(nav).queryByRole('link', { name: /profile/i })
    ).not.toBeInTheDocument()

    fireEvent.keyDown(
      within(nav).getByRole('button', { name: 'More navigation' }),
      { key: 'ArrowDown' }
    )

    expect(
      await screen.findByRole('menuitem', { name: /profile/i })
    ).toHaveAttribute('href', '/@llun@llun.test')
  })

  it('omits the Profile entry when no profileUrl is provided', async () => {
    renderMobileNav(<MobileNav />)

    fireEvent.keyDown(screen.getByRole('button', { name: 'More navigation' }), {
      key: 'ArrowDown'
    })

    // Wait for the menu to open via a known overflow item, then assert Profile
    // is absent.
    await screen.findByRole('menuitem', { name: /bookmarks/i })
    expect(
      screen.queryByRole('menuitem', { name: /profile/i })
    ).not.toBeInTheDocument()
  })
})
