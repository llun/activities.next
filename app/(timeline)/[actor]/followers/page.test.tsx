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

import Page, { generateMetadata } from './page'

const mockDatabase = {
  getFollowers: vi.fn(),
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
  FollowList: ({ emptyMessage }: { emptyMessage?: string }) => (
    <div data-testid="follow-list" data-empty-message={emptyMessage} />
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

describe('[actor] followers page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerAuthSession.mockResolvedValue(null)
    mockGetActorFromSession.mockResolvedValue(null)
    mockIsLocalFederationDomain.mockResolvedValue(false)
    mockGetProfileData.mockResolvedValue(null)
  })

  it('renders ActorRedirectCard for non-local actor when logged out', async () => {
    mockGetServerAuthSession.mockResolvedValue(null)
    mockIsLocalFederationDomain.mockResolvedValue(false)

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

    const continueLink = screen.getByRole('link', {
      name: /continue to pouet\.chapril\.org/i
    })
    expect(continueLink).toHaveAttribute(
      'href',
      'https://pouet.chapril.org/@clairenony/followers'
    )
    expect(mockNotFound).not.toHaveBeenCalled()
  })

  it('renders ActorRedirectCard for non-local actor when logged in', async () => {
    mockGetServerAuthSession.mockResolvedValue({
      user: { email: 'user@llun.social' }
    } as never)
    mockIsLocalFederationDomain.mockResolvedValue(false)

    const element = await Page({
      params: Promise.resolve({ actor: '@Edent@mastodon.social' })
    })
    render(element)

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'You are leaving llun.social'
      })
    ).toBeInTheDocument()

    const continueLink = screen.getByRole('link', {
      name: /continue to mastodon\.social/i
    })
    expect(continueLink).toHaveAttribute(
      'href',
      'https://mastodon.social/@Edent/followers'
    )
    expect(mockNotFound).not.toHaveBeenCalled()
  })

  it('calls notFound for local actor when profile is not found', async () => {
    mockGetServerAuthSession.mockResolvedValue(null)
    mockIsLocalFederationDomain.mockResolvedValue(true)
    mockGetProfileData.mockResolvedValue(null)

    await Page({
      params: Promise.resolve({ actor: '@unknown@llun.social' })
    })

    expect(mockNotFound).toHaveBeenCalled()
  })

  it('renders FollowList for local actor with followers', async () => {
    mockGetServerAuthSession.mockResolvedValue({
      user: { email: 'user@llun.social' }
    } as never)
    mockIsLocalFederationDomain.mockResolvedValue(true)
    mockGetProfileData.mockResolvedValue({
      person: {
        id: 'https://llun.social/users/localuser',
        preferredUsername: 'localuser'
      } as never,
      followersCount: 1,
      followingCount: 0,
      statusesCount: 0,
      attachments: [],
      isInternalAccount: true,
      hasFitnessData: false,
      statuses: [],
      statusPagination: { nextPageUrl: null, prevPageUrl: null }
    })
    mockDatabase.getFollowers.mockResolvedValue([
      {
        id: 'follow-1',
        actorId: 'https://llun.social/users/follower1',
        targetActorId: 'https://llun.social/users/localuser',
        status: 'Accepted',
        createdAt: 0,
        updatedAt: 0
      }
    ])
    mockDatabase.getActorFromId.mockResolvedValue({
      id: 'https://llun.social/users/follower1',
      username: 'follower1',
      domain: 'llun.social',
      name: 'Follower 1',
      summary: '',
      iconUrl: '',
      headerImageUrl: '',
      followersUrl: 'https://llun.social/users/follower1/followers',
      inboxUrl: 'https://llun.social/users/follower1/inbox',
      sharedInboxUrl: 'https://llun.social/inbox',
      followingCount: 0,
      followersCount: 0,
      statusCount: 0,
      lastStatusAt: null,
      createdAt: 0
    })

    const element = await Page({
      params: Promise.resolve({ actor: '@localuser@llun.social' })
    })
    render(element)

    expect(screen.getByTestId('follow-list')).toBeInTheDocument()
    expect(screen.getByText('1 accounts')).toBeInTheDocument()
    expect(mockNotFound).not.toHaveBeenCalled()
  })

  describe('generateMetadata', () => {
    it('sets canonical link and noindex robots for non-local actor', async () => {
      mockIsLocalFederationDomain.mockResolvedValue(false)

      const metadata = await generateMetadata({
        params: Promise.resolve({ actor: '@clairenony@pouet.chapril.org' })
      })

      expect(metadata).toEqual({
        title: 'Activities.next: @clairenony@pouet.chapril.org Followers',
        robots: { index: false, follow: false },
        alternates: {
          canonical: 'https://pouet.chapril.org/@clairenony/followers'
        }
      })
    })

    it('sets standard metadata for local actor', async () => {
      mockIsLocalFederationDomain.mockResolvedValue(true)

      const metadata = await generateMetadata({
        params: Promise.resolve({ actor: '@localuser@llun.social' })
      })

      expect(metadata).toEqual({
        title: 'Activities.next: @localuser@llun.social Followers'
      })
    })
  })

  it('renders followers page with follow list and empty message when profile is found', async () => {
    mockGetServerAuthSession.mockResolvedValue(null)
    mockIsLocalFederationDomain.mockResolvedValue(true)
    mockGetProfileData.mockResolvedValue({
      person: {
        id: 'https://llun.test/users/llun',
        preferredUsername: 'llun'
      } as unknown as Parameters<typeof getProfileData>[0] extends never
        ? never
        : NonNullable<Awaited<ReturnType<typeof getProfileData>>>['person'],
      statuses: [],
      statusesCount: 0,
      statusPagination: { nextPageUrl: null, prevPageUrl: null },
      attachments: [],
      followingCount: 0,
      followersCount: 0,
      isInternalAccount: true,
      hasFitnessData: false
    })
    mockDatabase.getFollowers.mockResolvedValue([])

    const result = await Page({
      params: Promise.resolve({ actor: '@llun@llun.test' })
    })

    const { render, screen } = await import('@testing-library/react')
    render(result as React.ReactElement)

    expect(screen.getByText('Followers')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Back to profile' })
    ).toHaveAttribute('href', '/@llun@llun.test')
    const followList = screen.getByTestId('follow-list')
    expect(followList).toBeInTheDocument()
    expect(followList).toHaveAttribute('data-empty-message', 'No followers yet')
  })

  it('renders PageHeader when user is logged in', async () => {
    mockGetServerAuthSession.mockResolvedValue({
      user: { email: 'user@llun.test' }
    } as never)
    mockIsLocalFederationDomain.mockResolvedValue(true)
    mockGetProfileData.mockResolvedValue({
      person: {
        id: 'https://llun.test/users/llun',
        preferredUsername: 'llun'
      } as unknown as Parameters<typeof getProfileData>[0] extends never
        ? never
        : NonNullable<Awaited<ReturnType<typeof getProfileData>>>['person'],
      statuses: [],
      statusesCount: 0,
      statusPagination: { nextPageUrl: null, prevPageUrl: null },
      attachments: [],
      followingCount: 0,
      followersCount: 42,
      isInternalAccount: true,
      hasFitnessData: false
    })
    mockDatabase.getFollowers.mockResolvedValue([])

    const result = await Page({
      params: Promise.resolve({ actor: '@llun@llun.test' })
    })

    const { render, screen } = await import('@testing-library/react')
    const { container } = render(result as React.ReactElement)

    expect(container.querySelector('.sticky')).toBeInTheDocument()
    expect(screen.getByText('Followers')).toBeInTheDocument()
    expect(screen.getByText('42 accounts')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Back to profile' })
    ).toHaveAttribute('href', '/@llun@llun.test')
  })

  it('renders navigation text and follower count on the same line without PageHeader when anonymous', async () => {
    mockGetServerAuthSession.mockResolvedValue(null)
    mockIsLocalFederationDomain.mockResolvedValue(true)
    mockGetProfileData.mockResolvedValue({
      person: {
        id: 'https://llun.test/users/llun',
        preferredUsername: 'llun'
      } as unknown as Parameters<typeof getProfileData>[0] extends never
        ? never
        : NonNullable<Awaited<ReturnType<typeof getProfileData>>>['person'],
      statuses: [],
      statusesCount: 0,
      statusPagination: { nextPageUrl: null, prevPageUrl: null },
      attachments: [],
      followingCount: 0,
      followersCount: 42,
      isInternalAccount: true,
      hasFitnessData: false
    })
    mockDatabase.getFollowers.mockResolvedValue([])

    const result = await Page({
      params: Promise.resolve({ actor: '@llun@llun.test' })
    })

    const { render, screen } = await import('@testing-library/react')
    const { container } = render(result as React.ReactElement)

    expect(container.querySelector('.sticky')).not.toBeInTheDocument()
    const heading = screen.getByRole('heading', { name: 'Followers' })
    expect(heading).toBeInTheDocument()
    const count = screen.getByText('42 accounts')
    expect(count).toBeInTheDocument()
    expect(heading.parentElement).toBe(count.parentElement)
    expect(
      screen.getByRole('link', { name: 'Back to profile' })
    ).toHaveAttribute('href', '/@llun@llun.test')
  })
})
