/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { notFound } from 'next/navigation'

import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { isLocalFederationDomain } from '@/lib/services/federation/domainPolicy'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { getProfileData } from './getProfileData'
import Page, { generateMetadata } from './page'

const mockDatabase = {}

vi.mock('@/lib/config', () => ({
  getConfig: () => ({
    host: 'llun.social',
    mediaStorage: null
  })
}))

vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/navigation', () => ({
  notFound: vi.fn()
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

vi.mock('./getProfileData', () => ({
  getProfileData: vi.fn()
}))

vi.mock('./ActorTimelines', () => ({
  ActorTimelines: () => <div data-testid="actor-timelines" />
}))

vi.mock('./ProfileHeaderImage', () => ({
  ProfileHeaderImage: () => <div data-testid="header-image" />
}))

vi.mock('./ProfileRelationshipActions', () => ({
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

  it('calls notFound for an unknown local user when logged out', async () => {
    mockGetServerAuthSession.mockResolvedValue(null)
    mockIsLocalFederationDomain.mockResolvedValue(true)
    mockGetProfileData.mockResolvedValue(null)

    await Page({
      params: Promise.resolve({ actor: '@unknown@llun.social' })
    })

    expect(mockNotFound).toHaveBeenCalled()
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
        title: 'Activities.next: @clairenony@pouet.chapril.org',
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
        title: 'Activities.next: @localuser@llun.social'
      })
    })
  })
})
