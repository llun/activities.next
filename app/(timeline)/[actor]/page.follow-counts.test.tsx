/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { isLocalFederationDomain } from '@/lib/services/federation/domainPolicy'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { getProfileData } from './getProfileData'
import Page from './page'

const mockDatabase = {
  getFeaturedTags: vi.fn().mockResolvedValue([])
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
  getMastodonFeaturedTag: vi.fn().mockResolvedValue([])
}))

const mockGetServerAuthSession = vi.mocked(getServerAuthSession)
const mockGetActorFromSession = vi.mocked(getActorFromSession)
const mockIsLocalFederationDomain = vi.mocked(isLocalFederationDomain)
const mockGetProfileData = vi.mocked(getProfileData)

describe('[actor] page follow counts display', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerAuthSession.mockResolvedValue({
      user: { email: 'user@llun.social' }
    } as never)
    mockGetActorFromSession.mockResolvedValue(null)
    mockIsLocalFederationDomain.mockResolvedValue(true)
  })

  it.each([
    {
      name: 'shows all three counts when they are numbers',
      counts: { posts: 100, following: 15, followers: 30 }
    },
    {
      name: 'omits Following when followingCount is null',
      counts: { posts: 100, following: null, followers: 30 }
    },
    {
      name: 'omits Followers when followersCount is null',
      counts: { posts: 100, following: 15, followers: null }
    },
    {
      name: 'omits both Following and Followers when both are null',
      counts: { posts: 100, following: null, followers: null }
    },
    {
      name: 'omits Posts when statusesCount is null',
      counts: { posts: null, following: 424, followers: 524 },
      handle: '@critical@blob.cat',
      id: 'https://blob.cat/users/critical',
      isInternalAccount: false
    },
    {
      name: 'renders 0 Posts when statusesCount is 0',
      counts: { posts: 0, following: 5, followers: 10 }
    },
    {
      name: 'omits the entire counts row when all counts are null',
      counts: { posts: null, following: null, followers: null },
      isInternalAccount: false
    }
  ])(
    '$name',
    async ({
      counts,
      handle = '@testuser@llun.social',
      id = 'https://llun.social/users/testuser',
      isInternalAccount = true
    }) => {
      mockGetProfileData.mockResolvedValue({
        person: {
          id,
          preferredUsername: handle.split('@')[1],
          summary: ''
        } as never,
        statusesCount: counts.posts,
        followingCount: counts.following,
        followersCount: counts.followers,
        statuses: [],
        statusPagination: { nextPageUrl: null, prevPageUrl: null },
        attachments: [],
        isInternalAccount,
        hasFitnessData: false,
        hasGalleryMedia: false,
        gallerySubviews: []
      })

      const element = await Page({ params: Promise.resolve({ actor: handle }) })
      render(element)

      for (const [label, count] of [
        ['Posts', counts.posts],
        ['Following', counts.following],
        ['Followers', counts.followers]
      ] as const) {
        if (count === null) {
          expect(screen.queryByText(label)).not.toBeInTheDocument()
        } else {
          expect(screen.getByText(String(count))).toBeInTheDocument()
          expect(screen.getByText(label)).toBeInTheDocument()
        }
      }
    }
  )

  it('links the Following and Followers counts to their lists and leaves Posts as plain text', async () => {
    mockGetProfileData.mockResolvedValue({
      person: {
        id: 'https://llun.social/users/testuser',
        preferredUsername: 'testuser',
        summary: ''
      } as never,
      statusesCount: 100,
      followingCount: 15,
      followersCount: 30,
      statuses: [],
      statusPagination: { nextPageUrl: null, prevPageUrl: null },
      attachments: [],
      isInternalAccount: true,
      hasFitnessData: false,
      hasGalleryMedia: false,
      gallerySubviews: []
    })

    const element = await Page({
      params: Promise.resolve({ actor: '@testuser@llun.social' })
    })
    render(element)

    expect(screen.getByRole('link', { name: /Following/ })).toHaveAttribute(
      'href',
      '/@testuser@llun.social/following'
    )
    expect(screen.getByRole('link', { name: /Followers/ })).toHaveAttribute(
      'href',
      '/@testuser@llun.social/followers'
    )
    expect(screen.queryByRole('link', { name: /Posts/ })).toBeNull()
    expect(
      screen.getAllByRole('heading', { level: 1 }),
      'one h1 on the profile'
    ).toHaveLength(1)
  })

  it.each([
    [
      'falls back to the username when the actor has no display name',
      '',
      'testuser'
    ],
    ['uses the display name when there is one', 'Test User', 'Test User']
  ])('h1 %s', async (_title, name, expected) => {
    mockGetProfileData.mockResolvedValue({
      person: {
        id: 'https://llun.social/users/testuser',
        preferredUsername: 'testuser',
        name,
        summary: ''
      } as never,
      statusesCount: 1,
      followingCount: 1,
      followersCount: 1,
      statuses: [],
      statusPagination: { nextPageUrl: null, prevPageUrl: null },
      attachments: [],
      isInternalAccount: true,
      hasFitnessData: false,
      hasGalleryMedia: false,
      gallerySubviews: []
    })

    const element = await Page({
      params: Promise.resolve({ actor: '@testuser@llun.social' })
    })
    render(element)

    expect(
      screen.getByRole('heading', { level: 1, name: expected })
    ).toBeInTheDocument()
  })
})
