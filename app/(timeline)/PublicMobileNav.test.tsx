/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'

import { MobileNavigationProvider } from '@/lib/components/layout/mobile-navigation-context'
import { MobileNavigationTrigger } from '@/lib/components/layout/mobile-navigation-trigger'
import { getNavItem } from '@/lib/components/layout/nav-items'
import { NAV_ITEM_IDS } from '@/lib/services/navigation/navPreferences'

import { PublicMobileNav } from './PublicMobileNav'

vi.mock('next/navigation', () => ({
  usePathname: () => '/@alice@example.com'
}))

const openDrawer = (registrationOpen: boolean) => {
  render(
    <MobileNavigationProvider>
      <MobileNavigationTrigger variant="floating" />
      <PublicMobileNav registrationOpen={registrationOpen} />
    </MobileNavigationProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
  return screen.getByRole('dialog')
}

describe('PublicMobileNav', () => {
  it('offers Home, Sign in and Create account while registration is open', () => {
    const drawer = openDrawer(true)

    expect(within(drawer).getByRole('link', { name: 'Home' })).toHaveAttribute(
      'href',
      '/'
    )
    expect(
      within(drawer).getByRole('link', { name: 'Sign in' })
    ).toHaveAttribute('href', '/auth/signin')
    expect(
      within(drawer).getByRole('link', { name: 'Create account' })
    ).toHaveAttribute('href', '/auth/signup')
  })

  it('hides Create account when registration is closed but keeps Sign in', () => {
    const drawer = openDrawer(false)

    expect(
      within(drawer).getByRole('link', { name: 'Sign in' })
    ).toBeInTheDocument()
    expect(
      within(drawer).queryByRole('link', { name: 'Create account' })
    ).not.toBeInTheDocument()
  })

  it('never links to a signed-in destination from the nav registry', () => {
    const drawer = openDrawer(true)

    const hrefs = within(drawer)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'))
    const privateHrefs = NAV_ITEM_IDS.map(
      (id) => getNavItem(id, { fitnessUrl: '/fitness' }).href
    ).filter((href) => href !== '/')

    expect(privateHrefs.length).toBeGreaterThan(0)
    for (const href of privateHrefs) {
      expect(hrefs).not.toContain(href)
    }
  })

  it('closes when a destination is chosen', () => {
    const drawer = openDrawer(true)

    fireEvent.click(within(drawer).getByRole('link', { name: 'Sign in' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
