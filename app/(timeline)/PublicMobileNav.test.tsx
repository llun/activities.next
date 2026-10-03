/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within
} from '@testing-library/react'

import { MobileNavigationProvider } from '@/lib/components/layout/mobile-navigation-context'
import { MobileNavigationTrigger } from '@/lib/components/layout/mobile-navigation-trigger'
import { getNavItem } from '@/lib/components/layout/nav-items'
import { NAV_ITEM_IDS } from '@/lib/services/navigation/navPreferences'

import { PublicMobileNav } from './PublicMobileNav'

let mockPathname = '/@alice@example.com'

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname
}))

const openDrawer = (
  registrationOpen: boolean,
  hrefs: { signinHref?: string; signupHref?: string } = {}
) => {
  render(
    <MobileNavigationProvider>
      <MobileNavigationTrigger variant="floating" />
      <PublicMobileNav
        registrationOpen={registrationOpen}
        logoSrc="https://canonical.example/logo-nav.png"
        {...hrefs}
      />
    </MobileNavigationProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
  return screen.getByRole('dialog')
}

describe('PublicMobileNav', () => {
  beforeEach(() => {
    mockPathname = '/@alice@example.com'
  })

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

  // The shared heatmap passes its own auth URLs; the drawer must use them.
  it('uses the sign-in and sign-up hrefs it is given', () => {
    const drawer = openDrawer(true, {
      signinHref: '/auth/signin?next=a',
      signupHref: '/auth/signup?next=a'
    })

    expect(
      within(drawer).getByRole('link', { name: 'Sign in' })
    ).toHaveAttribute('href', '/auth/signin?next=a')
    expect(
      within(drawer).getByRole('link', { name: 'Create account' })
    ).toHaveAttribute('href', '/auth/signup?next=a')
  })

  it('marks Home as the current page only on /', () => {
    let drawer = openDrawer(true)
    expect(
      within(drawer).getByRole('link', { name: 'Home' })
    ).not.toHaveAttribute('aria-current')
    cleanup()

    mockPathname = '/'
    drawer = openDrawer(true)
    expect(within(drawer).getByRole('link', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page'
    )
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

  // Below md the drawer holds the page's only logo, and on a CDN alias domain
  // the root-relative default is redirected away.
  it('renders the logo from the canonical-origin src it is given', () => {
    render(
      <MobileNavigationProvider>
        <MobileNavigationTrigger variant="floating" />
        <PublicMobileNav
          registrationOpen
          logoSrc="https://canonical.example/logo-nav.png"
        />
      </MobileNavigationProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))

    const logo = within(screen.getByRole('dialog')).getByRole('link', {
      name: 'Activities home'
    })
    // next/image routes the URL through its optimizer, so match it encoded.
    expect(logo.querySelector('img')?.getAttribute('src')).toContain(
      encodeURIComponent('https://canonical.example/logo-nav.png')
    )
  })

  it.each(['Home', 'Sign in'])('closes when %s is chosen', (name) => {
    const drawer = openDrawer(true)

    fireEvent.click(within(drawer).getByRole('link', { name }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
