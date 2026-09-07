/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { notFound } from 'next/navigation'

import { getProfileData } from '@/app/(timeline)/[actor]/getProfileData'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { isLocalFederationDomain } from '@/lib/services/federation/domainPolicy'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { FollowListPage, generateFollowListMetadata } from './FollowListPage'

const mockDatabase = {
  getFollowers: vi.fn(),
  getFollowing: vi.fn(),
  getActorsFromIds: vi.fn(),
  getActorFromId: vi.fn()
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

vi.mock('@/app/(timeline)/[actor]/getProfileData', () => ({
  getProfileData: vi.fn()
}))

vi.mock('@/app/(timeline)/[actor]/FollowList', () => ({
  FollowList: ({
    emptyMessage,
    users
  }: {
    emptyMessage?: string
    users?: { id: string; username: string }[]
  }) => (
    <div data-testid="follow-list" data-empty-message={emptyMessage}>
      {users?.map((u) => (
        <span key={u.id} data-testid={`user-${u.id}`}>
          {u.username}
        </span>
      ))}
    </div>
  )
}))

vi.mock('@/app/(timeline)/[actor]/getFollowListBlockedActorIds', () => ({
  getFollowListBlockedActorIds: vi.fn().mockResolvedValue([])
}))

const mockGetServerAuthSession = vi.mocked(getServerAuthSession)
const mockGetActorFromSession = vi.mocked(getActorFromSession)
const mockIsLocalFederationDomain = vi.mocked(isLocalFederationDomain)
const mockGetProfileData = vi.mocked(getProfileData)
const mockNotFound = vi.mocked(notFound)

describe('FollowListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerAuthSession.mockResolvedValue(null)
    mockGetActorFromSession.mockResolvedValue(null)
    mockIsLocalFederationDomain.mockResolvedValue(false)
    mockGetProfileData.mockResolvedValue(null)
  })

  describe('redirect handling', () => {
    it('renders ActorRedirectCard for non-local actor on followers direction', async () => {
      const element = await FollowListPage({
        params: Promise.resolve({ actor: '@clairenony@pouet.chapril.org' }),
        direction: 'followers'
      })
      render(element)

      expect(
        screen.getByRole('heading', {
          level: 1,
          name: 'You are leaving llun.social'
        })
      ).toBeInTheDocument()

      const link = screen.getByRole('link', {
        name: /continue to pouet\.chapril\.org/i
      })
      expect(link).toHaveAttribute(
        'href',
        'https://pouet.chapril.org/@clairenony/followers'
      )
    })

    it('renders ActorRedirectCard for non-local actor on following direction', async () => {
      const element = await FollowListPage({
        params: Promise.resolve({ actor: '@clairenony@pouet.chapril.org' }),
        direction: 'following'
      })
      render(element)

      expect(
        screen.getByRole('heading', {
          level: 1,
          name: 'You are leaving llun.social'
        })
      ).toBeInTheDocument()

      const link = screen.getByRole('link', {
        name: /continue to pouet\.chapril\.org/i
      })
      expect(link).toHaveAttribute(
        'href',
        'https://pouet.chapril.org/@clairenony/following'
      )
    })
  })

  describe('missing actor / not-found handling', () => {
    it('calls notFound when actor handle format is invalid', async () => {
      await FollowListPage({
        params: Promise.resolve({ actor: 'invalid' }),
        direction: 'followers'
      })
      expect(mockNotFound).toHaveBeenCalled()
    })

    it('calls notFound when profile is not found', async () => {
      mockIsLocalFederationDomain.mockResolvedValue(true)
      mockGetProfileData.mockResolvedValue(null)

      await FollowListPage({
        params: Promise.resolve({ actor: '@someone@llun.social' }),
        direction: 'followers'
      })
      expect(mockNotFound).toHaveBeenCalled()
    })
  })

  describe('public and authenticated shell', () => {
    const mockProfile = {
      person: {
        id: 'https://llun.social/users/someone',
        preferredUsername: 'someone',
        name: 'Someone'
      },
      followersCount: 10,
      followingCount: 5
    }

    it('renders unauthenticated shell (no sticky PageHeader) for logged-out visitor', async () => {
      mockIsLocalFederationDomain.mockResolvedValue(true)
      mockGetProfileData.mockResolvedValue(mockProfile as never)
      mockDatabase.getFollowers.mockResolvedValue([])
      mockDatabase.getActorsFromIds.mockResolvedValue([])

      const element = await FollowListPage({
        params: Promise.resolve({ actor: '@someone@llun.social' }),
        direction: 'followers'
      })
      const { container } = render(element)

      expect(container.querySelector('.sticky')).not.toBeInTheDocument()
      expect(
        screen.getByRole('heading', { name: 'Followers' })
      ).toBeInTheDocument()
      expect(screen.getByText('10 accounts')).toBeInTheDocument()
      expect(screen.getByTestId('follow-list')).toHaveAttribute(
        'data-empty-message',
        'No followers yet'
      )
    })

    it('renders authenticated PageHeader shell for logged-in user', async () => {
      mockGetServerAuthSession.mockResolvedValue({
        user: { email: 'viewer@llun.social' }
      } as never)
      mockIsLocalFederationDomain.mockResolvedValue(true)
      mockGetProfileData.mockResolvedValue(mockProfile as never)
      mockDatabase.getFollowing.mockResolvedValue([])
      mockDatabase.getActorsFromIds.mockResolvedValue([])

      const element = await FollowListPage({
        params: Promise.resolve({ actor: '@someone@llun.social' }),
        direction: 'following'
      })
      const { container } = render(element)

      expect(container.querySelector('.sticky')).toBeInTheDocument()
      expect(screen.getByText('Following')).toBeInTheDocument()
      expect(screen.getByText('5 accounts')).toBeInTheDocument()
      expect(screen.getByTestId('follow-list')).toHaveAttribute(
        'data-empty-message',
        'Not following anyone yet'
      )
    })
  })

  describe('metadata generation', () => {
    it('sets canonical link and robots for non-local actor', async () => {
      mockIsLocalFederationDomain.mockResolvedValue(false)
      const meta = await generateFollowListMetadata({
        params: Promise.resolve({ actor: '@user@remote.social' }),
        direction: 'followers'
      })
      expect(meta).toEqual({
        title: 'Activities.next: @user@remote.social Followers',
        robots: { index: false, follow: false },
        alternates: {
          canonical: 'https://remote.social/@user/followers'
        }
      })
    })

    it('sets standard title for local actor', async () => {
      mockIsLocalFederationDomain.mockResolvedValue(true)
      const meta = await generateFollowListMetadata({
        params: Promise.resolve({ actor: '@user@llun.social' }),
        direction: 'following'
      })
      expect(meta).toEqual({
        title: 'Activities.next: @user@llun.social Following'
      })
    })
  })
})
