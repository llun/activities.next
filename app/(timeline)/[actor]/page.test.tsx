/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { isLocalFederationDomain } from '@/lib/services/federation/domainPolicy'
import { Actor } from '@/lib/types/activitypub'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { getProfileData } from './getProfileData'
import Page from './page'

const mockDatabase = {
  getFeaturedTags: vi.fn().mockResolvedValue([]),
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

describe('[actor] page header handle link', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerAuthSession.mockResolvedValue({
      user: { email: 'viewer@llun.social' }
    } as never)
    mockGetActorFromSession.mockResolvedValue(null)
    mockIsLocalFederationDomain.mockResolvedValue(false)
  })

  it('renders handle as a link opening in a new tab for a remote user with string url', async () => {
    mockGetProfileData.mockResolvedValue({
      person: {
        id: 'https://pouet.chapril.org/users/clairenony',
        type: 'Person',
        preferredUsername: 'clairenony',
        name: 'Claire Nony',
        summary: 'Hello world',
        url: 'https://pouet.chapril.org/@clairenony'
      } as unknown as Actor,
      statuses: [],
      statusesCount: 5,
      statusPagination: { nextPageUrl: null, prevPageUrl: null },
      attachments: [],
      followingCount: 10,
      followersCount: 20,
      isInternalAccount: false,
      hasFitnessData: false,
      isPixelfed: false
    })

    const element = await Page({
      params: Promise.resolve({ actor: '@clairenony@pouet.chapril.org' })
    })
    render(element)

    const link = screen.getByRole('link', { name: '@clairenony' })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute(
      'href',
      'https://pouet.chapril.org/@clairenony'
    )
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveAttribute('title', 'Open profile page')
  })

  it('renders handle link for remote user with object url', async () => {
    mockGetProfileData.mockResolvedValue({
      person: {
        id: 'https://mastodon.social/users/bob',
        type: 'Person',
        preferredUsername: 'bob',
        name: 'Bob',
        summary: '',
        url: { type: 'Link', href: 'https://mastodon.social/@bob' }
      } as unknown as Actor,
      statuses: [],
      statusesCount: 1,
      statusPagination: { nextPageUrl: null, prevPageUrl: null },
      attachments: [],
      followingCount: 2,
      followersCount: 3,
      isInternalAccount: false,
      hasFitnessData: false,
      isPixelfed: false
    })

    const element = await Page({
      params: Promise.resolve({ actor: '@bob@mastodon.social' })
    })
    render(element)

    const link = screen.getByRole('link', { name: '@bob' })
    expect(link).toHaveAttribute('href', 'https://mastodon.social/@bob')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('falls back to person.id when person.url is missing', async () => {
    mockGetProfileData.mockResolvedValue({
      person: {
        id: 'https://remote.example/users/alice',
        type: 'Person',
        preferredUsername: 'alice',
        name: 'Alice',
        summary: ''
      } as unknown as Actor,
      statuses: [],
      statusesCount: 0,
      statusPagination: { nextPageUrl: null, prevPageUrl: null },
      attachments: [],
      followingCount: 0,
      followersCount: 0,
      isInternalAccount: false,
      hasFitnessData: false,
      isPixelfed: false
    })

    const element = await Page({
      params: Promise.resolve({ actor: '@alice@remote.example' })
    })
    render(element)

    const link = screen.getByRole('link', { name: '@alice' })
    expect(link).toHaveAttribute('href', 'https://remote.example/users/alice')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('renders handle as a link opening in a new tab for a local user', async () => {
    mockIsLocalFederationDomain.mockResolvedValue(true)
    mockGetProfileData.mockResolvedValue({
      person: {
        id: 'https://llun.social/users/localuser',
        type: 'Person',
        preferredUsername: 'localuser',
        name: 'Local User',
        summary: 'Local bio',
        url: 'https://llun.social/@localuser'
      } as unknown as Actor,
      statuses: [],
      statusesCount: 12,
      statusPagination: { nextPageUrl: null, prevPageUrl: null },
      attachments: [],
      followingCount: 3,
      followersCount: 4,
      isInternalAccount: true,
      hasFitnessData: false,
      isPixelfed: false
    })

    const element = await Page({
      params: Promise.resolve({ actor: '@localuser@llun.social' })
    })
    render(element)

    const link = screen.getByRole('link', { name: '@localuser' })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', 'https://llun.social/@localuser')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
