/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'
import { notFound } from 'next/navigation'

import { getProfileData } from '@/app/(timeline)/[actor]/getProfileData'
import { MobileNavigationProvider } from '@/lib/components/layout/mobile-navigation-context'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { isLocalFederationDomain } from '@/lib/services/federation/domainPolicy'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import Page, { generateMetadata } from './page'

const mockDatabase = {
  getActorSettings: vi.fn().mockResolvedValue(undefined)
}

vi.mock('@/lib/config', () => ({
  getConfig: () => ({
    host: 'llun.social',
    mediaStorage: null
  }),
  getBaseURL: () => 'https://llun.social'
}))

vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/navigation', () => ({
  notFound: vi.fn(),
  usePathname: () => '/@clairenony@pouet.chapril.org'
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn()
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: vi.fn()
}))

vi.mock('@/lib/services/federation/domainPolicy', () => ({
  isLocalFederationDomain: vi.fn()
}))

vi.mock('@/app/(timeline)/[actor]/getProfileData', () => ({
  getProfileData: vi.fn()
}))

vi.mock('@/app/(timeline)/[actor]/ActorTimelines', () => ({
  ActorTimelines: () => <div data-testid="actor-timelines" />
}))

vi.mock('@/app/(timeline)/[actor]/ProfileHeaderImage', () => ({
  ProfileHeaderImage: () => <div data-testid="header-image" />
}))

vi.mock('@/app/(timeline)/[actor]/ProfileRelationshipActions', () => ({
  ProfileRelationshipActions: () => <div data-testid="relationship-actions" />
}))

vi.mock('@/lib/services/mastodon/getMastodonFeaturedTag', () => ({
  getMastodonFeaturedTag: vi.fn()
}))

const mockGetServerAuthSession = vi.mocked(getServerAuthSession)
const mockGetActorFromSession = vi.mocked(getActorFromSession)
const mockIsLocalFederationDomain = vi.mocked(isLocalFederationDomain)
const mockGetProfileData = vi.mocked(getProfileData)
const mockNotFound = vi.mocked(notFound)

describe('[actor] page redirects and non-local handles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerAuthSession.mockResolvedValue(null)
    mockGetActorFromSession.mockResolvedValue(null)
    mockIsLocalFederationDomain.mockResolvedValue(false)
    mockGetProfileData.mockResolvedValue(null)
  })

  it('renders ActorRedirectCard for a non-local user when logged out', async () => {
    mockGetServerAuthSession.mockResolvedValue(null)
    mockIsLocalFederationDomain.mockResolvedValue(false)
    mockGetProfileData.mockResolvedValue(null)

    const element = await Page({
      params: Promise.resolve({ actor: '@clairenony@pouet.chapril.org' })
    })
    render(element)

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'You are leaving llun.social'
      })
    ).toBeInTheDocument()
    expect(
      screen.getByText('If you trust this link, click it to continue.')
    ).toBeInTheDocument()

    const continueLink = screen.getByRole('link', {
      name: /continue to pouet\.chapril\.org/i
    })
    expect(continueLink).toHaveAttribute(
      'href',
      'https://pouet.chapril.org/@clairenony'
    )
    expect(continueLink).toHaveAttribute('rel', 'noopener noreferrer')
    expect(mockNotFound).not.toHaveBeenCalled()
  })

  // The redirect card's own heading stays the page's h1, so below md the
  // compact bar only names the page.
  it('names the page "Profile" in the compact bar above the redirect card', async () => {
    const element = await Page({
      params: Promise.resolve({ actor: '@clairenony@pouet.chapril.org' })
    })
    const { container } = render(
      <MobileNavigationProvider>{element}</MobileNavigationProvider>
    )

    const bar = container.querySelector(
      '[data-mobile-compact-header]'
    ) as HTMLElement
    expect(within(bar).getByText('Profile').tagName).toBe('P')
  })

  it('calls notFound for an unknown local user when logged out', async () => {
    mockGetServerAuthSession.mockResolvedValue(null)
    mockIsLocalFederationDomain.mockResolvedValue(true)
    mockGetProfileData.mockResolvedValue(null)

    await Page({
      params: Promise.resolve({ actor: '@unknown@llun.social' })
    })

    expect(mockNotFound).toHaveBeenCalled()
  })

  // Pins the difference documented on getNonLocalActorRedirectTarget: unlike
  // followers/page.tsx and following/page.tsx (which redirect any visitor),
  // [actor]/(profile)/page.tsx only redirects a LOGGED-OUT visitor. A signed-in visitor
  // to an unresolvable non-local actor still gets notFound, not a redirect
  // card, so they always get a chance to resolve the actor locally first.
  it('calls notFound instead of redirecting for a non-local actor when logged in', async () => {
    mockGetServerAuthSession.mockResolvedValue({
      user: { email: 'user@llun.social' }
    } as never)
    mockGetActorFromSession.mockResolvedValue({
      id: 'https://llun.social/users/user'
    } as never)
    mockIsLocalFederationDomain.mockResolvedValue(false)
    mockGetProfileData.mockResolvedValue(null)

    await Page({
      params: Promise.resolve({ actor: '@clairenony@pouet.chapril.org' })
    })

    expect(mockNotFound).toHaveBeenCalled()
  })

  // A session minted before a moderation action is not a signed-in visitor: the
  // flag gates the signed remote-profile fetch and the actor save, so a
  // suspended actor must take the anonymous path.
  it('treats a suspended session as anonymous for the remote-profile fetch', async () => {
    mockGetServerAuthSession.mockResolvedValue({
      user: { email: 'user@llun.social' }
    } as never)
    mockGetActorFromSession.mockResolvedValue({
      id: 'https://llun.social/users/user',
      suspendedAt: 1
    } as never)
    mockIsLocalFederationDomain.mockResolvedValue(false)
    mockGetProfileData.mockResolvedValue(null)

    await Page({
      params: Promise.resolve({ actor: '@clairenony@pouet.chapril.org' })
    })

    expect(mockGetProfileData).toHaveBeenCalledWith(
      expect.anything(),
      '@clairenony@pouet.chapril.org',
      false,
      expect.anything()
    )
  })

  it('calls notFound for invalid actor handle parameter', async () => {
    await Page({
      params: Promise.resolve({ actor: 'invalid' })
    })

    expect(mockNotFound).toHaveBeenCalled()
  })

  describe('generateMetadata', () => {
    it('sets canonical link and noindex robots for logged-out non-local actor', async () => {
      mockGetServerAuthSession.mockResolvedValue(null)
      mockIsLocalFederationDomain.mockResolvedValue(false)

      const metadata = await generateMetadata({
        params: Promise.resolve({ actor: '@clairenony@pouet.chapril.org' })
      })

      expect(metadata).toEqual({
        title: '@clairenony@pouet.chapril.org',
        robots: { index: false, follow: false },
        alternates: {
          canonical: 'https://pouet.chapril.org/@clairenony'
        }
      })
    })

    it('sets standard metadata for local actor', async () => {
      mockGetServerAuthSession.mockResolvedValue(null)
      mockIsLocalFederationDomain.mockResolvedValue(true)

      const metadata = await generateMetadata({
        params: Promise.resolve({ actor: '@localuser@llun.social' })
      })

      expect(metadata).toEqual({
        title: '@localuser@llun.social'
      })
    })

    // Pins the same page.tsx-only !isLoggedIn gate for metadata: a signed-in
    // visitor gets the standard (non-redirect) metadata even for a non-local
    // actor, unlike followers/page.tsx and following/page.tsx.
    it('sets standard metadata (no redirect) for non-local actor when logged in', async () => {
      mockGetServerAuthSession.mockResolvedValue({
        user: { email: 'user@llun.social' }
      } as never)
      mockGetActorFromSession.mockResolvedValue({
        id: 'https://llun.social/users/user'
      } as never)
      mockIsLocalFederationDomain.mockResolvedValue(false)

      const metadata = await generateMetadata({
        params: Promise.resolve({ actor: '@clairenony@pouet.chapril.org' })
      })

      expect(metadata).toEqual({
        title: '@clairenony@pouet.chapril.org'
      })
    })

    // The same gate applies to metadata: a suspended session is anonymous, so
    // the non-local actor gets the no-index canonical metadata a logged-out
    // visitor gets, not the signed-in standard title.
    it('treats a suspended session as anonymous for metadata', async () => {
      mockGetServerAuthSession.mockResolvedValue({
        user: { email: 'user@llun.social' }
      } as never)
      mockGetActorFromSession.mockResolvedValue({
        id: 'https://llun.social/users/user',
        suspendedAt: 1
      } as never)
      mockIsLocalFederationDomain.mockResolvedValue(false)

      const metadata = await generateMetadata({
        params: Promise.resolve({ actor: '@clairenony@pouet.chapril.org' })
      })

      expect(metadata).toEqual({
        title: '@clairenony@pouet.chapril.org',
        robots: { index: false, follow: false },
        alternates: { canonical: 'https://pouet.chapril.org/@clairenony' }
      })
    })
  })
})
