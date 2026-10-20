/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

import { MobileCompactHeader } from '@/lib/components/layout/mobile-compact-header'
import { MobileNavigationTrigger } from '@/lib/components/layout/mobile-navigation-trigger'
import { getDatabase } from '@/lib/database'
import { getVisitedSignUpDomain } from '@/lib/services/domains/visitedSignUpDomain'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'

import { PublicShell } from './PublicShell'
import type * as PublicTopBarModule from './PublicTopBar'

// PublicTopBar is an async server component, which the shell renders as an
// element; the shell test swaps in a stub and the top bar tests below load the
// real one.
vi.mock('./PublicTopBar', () => ({
  PublicTopBar: () => <header data-testid="public-top-bar" />
}))

const loadPublicTopBar = async () =>
  (await vi.importActual<typeof PublicTopBarModule>('./PublicTopBar'))
    .PublicTopBar

// PublicFooter is an async server component too (it reads the visited
// domain's policies).
vi.mock('./PublicFooter', () => ({
  PublicFooter: () => <footer data-testid="public-footer" />
}))

vi.mock('@/app/Modal', () => ({
  Modal: () => null
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: () => 'https://canonical.example'
}))

vi.mock('@/lib/services/serverSettings', () => ({
  getResolvedServerSettings: vi.fn()
}))

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => null)
}))

vi.mock('@/lib/services/domains/visitedSignUpDomain', () => ({
  getVisitedSignUpDomain: vi.fn()
}))

const mockSettings = vi.mocked(getResolvedServerSettings)
const mockGetDatabase = vi.mocked(getDatabase)
const mockVisitedDomain = vi.mocked(getVisitedSignUpDomain)

const mockRegistration = (open: boolean) =>
  mockSettings.mockResolvedValue({
    registrations: { open }
  } as Awaited<ReturnType<typeof getResolvedServerSettings>>)

// The redesigned mobile chrome (compact bar, floating profile button, drawer)
// is for signed-in viewers only. Logged out, every width keeps the branded
// top bar with the sign-in CTAs.
describe('PublicTopBar', () => {
  beforeEach(() => {
    mockSettings.mockReset()
    mockVisitedDomain.mockReset()
    mockGetDatabase.mockReturnValue(null)
  })

  it('shows the logo and both CTAs', async () => {
    mockRegistration(true)
    const PublicTopBar = await loadPublicTopBar()
    render(await PublicTopBar())

    const banner = screen.getByRole('banner')
    // The logo is on the canonical origin, so it resolves when the page is
    // served from a CDN alias domain.
    const home = within(banner).getByRole('link', { name: 'Activities home' })
    expect(home.querySelector('img')?.getAttribute('src')).toContain(
      encodeURIComponent('https://canonical.example/logo-nav.png')
    )
    expect(
      within(banner).getByRole('link', { name: 'Sign in' })
    ).toHaveAttribute('href', '/auth/signin')
    expect(
      within(banner).getByRole('link', { name: 'Create account' })
    ).toHaveAttribute('href', '/auth/signup')
  })

  it('hides Create account while registration is closed', async () => {
    mockRegistration(false)
    const PublicTopBar = await loadPublicTopBar()
    render(await PublicTopBar())

    const banner = screen.getByRole('banner')
    expect(
      within(banner).getByRole('link', { name: 'Sign in' })
    ).toBeInTheDocument()
    expect(
      within(banner).queryByRole('link', { name: 'Create account' })
    ).not.toBeInTheDocument()
  })

  it("follows the visited domain's sign-ups when there is a database", async () => {
    // The primary is open, the visited domain is closed: the domain wins.
    mockRegistration(true)
    mockGetDatabase.mockReturnValue(
      {} as unknown as ReturnType<typeof getDatabase>
    )
    mockVisitedDomain.mockResolvedValue({
      open: false
    } as Awaited<ReturnType<typeof getVisitedSignUpDomain>>)
    const PublicTopBar = await loadPublicTopBar()
    render(await PublicTopBar())

    const banner = screen.getByRole('banner')
    expect(
      within(banner).queryByRole('link', { name: 'Create account' })
    ).not.toBeInTheDocument()
    expect(mockSettings).not.toHaveBeenCalled()
  })
})

describe('PublicShell', () => {
  it('provides no mobile navigation, so page chrome renders no menu, bar or drawer', () => {
    const { container } = render(
      <PublicShell>
        <MobileCompactHeader title="Post" />
        <MobileNavigationTrigger variant="floating" />
        <p>content</p>
      </PublicShell>
    )

    expect(screen.getByTestId('public-top-bar')).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Open navigation' })
    ).not.toBeInTheDocument()
    expect(
      container.querySelector('[data-mobile-compact-header]')
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
