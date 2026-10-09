/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'
import { ReactElement } from 'react'

import { MobileCompactHeader } from '@/lib/components/layout/mobile-compact-header'
import { MobileNavigationTrigger } from '@/lib/components/layout/mobile-navigation-trigger'
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

vi.mock('@/app/Modal', () => ({
  Modal: () => null
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: () => 'https://canonical.example'
}))

vi.mock('@/lib/services/serverSettings', () => ({
  getResolvedServerSettings: vi.fn()
}))

const mockSettings = vi.mocked(getResolvedServerSettings)

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
  })

  it('shows the Sign in and Create account CTAs', async () => {
    mockRegistration(true)
    const PublicTopBar = await loadPublicTopBar()
    render(await PublicTopBar())

    const banner = screen.getByRole('banner')
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
})

describe('PublicShell', () => {
  it('provides no mobile navigation, so page chrome renders no menu, bar or drawer', () => {
    const { container } = render(
      PublicShell({
        children: (
          <>
            <MobileCompactHeader title="Post" />
            <MobileNavigationTrigger variant="floating" />
            <p>content</p>
          </>
        )
      }) as ReactElement
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
