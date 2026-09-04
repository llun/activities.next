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

  it('renders both Following and Followers links when counts are numbers', async () => {
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
      hasFitnessData: false
    })

    const element = await Page({
      params: Promise.resolve({ actor: '@testuser@llun.social' })
    })
    render(element)

    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText('Posts')).toBeInTheDocument()
    expect(screen.getByText('15')).toBeInTheDocument()
    expect(screen.getByText('Following')).toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument()
    expect(screen.getByText('Followers')).toBeInTheDocument()
  })

  it('omits Following when followingCount is null but shows Followers', async () => {
    mockGetProfileData.mockResolvedValue({
      person: {
        id: 'https://llun.social/users/testuser',
        preferredUsername: 'testuser',
        summary: ''
      } as never,
      statusesCount: 100,
      followingCount: null,
      followersCount: 30,
      statuses: [],
      statusPagination: { nextPageUrl: null, prevPageUrl: null },
      attachments: [],
      isInternalAccount: true,
      hasFitnessData: false
    })

    const element = await Page({
      params: Promise.resolve({ actor: '@testuser@llun.social' })
    })
    render(element)

    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText('Posts')).toBeInTheDocument()
    expect(screen.queryByText('Following')).not.toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument()
    expect(screen.getByText('Followers')).toBeInTheDocument()
  })

  it('omits Followers when followersCount is null but shows Following', async () => {
    mockGetProfileData.mockResolvedValue({
      person: {
        id: 'https://llun.social/users/testuser',
        preferredUsername: 'testuser',
        summary: ''
      } as never,
      statusesCount: 100,
      followingCount: 15,
      followersCount: null,
      statuses: [],
      statusPagination: { nextPageUrl: null, prevPageUrl: null },
      attachments: [],
      isInternalAccount: true,
      hasFitnessData: false
    })

    const element = await Page({
      params: Promise.resolve({ actor: '@testuser@llun.social' })
    })
    render(element)

    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText('Posts')).toBeInTheDocument()
    expect(screen.getByText('15')).toBeInTheDocument()
    expect(screen.getByText('Following')).toBeInTheDocument()
    expect(screen.queryByText('Followers')).not.toBeInTheDocument()
  })

  it('omits both Following and Followers when both counts are null', async () => {
    mockGetProfileData.mockResolvedValue({
      person: {
        id: 'https://llun.social/users/testuser',
        preferredUsername: 'testuser',
        summary: ''
      } as never,
      statusesCount: 100,
      followingCount: null,
      followersCount: null,
      statuses: [],
      statusPagination: { nextPageUrl: null, prevPageUrl: null },
      attachments: [],
      isInternalAccount: true,
      hasFitnessData: false
    })

    const element = await Page({
      params: Promise.resolve({ actor: '@testuser@llun.social' })
    })
    render(element)

    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText('Posts')).toBeInTheDocument()
    expect(screen.queryByText('Following')).not.toBeInTheDocument()
    expect(screen.queryByText('Followers')).not.toBeInTheDocument()
  })

  it('omits Posts when statusesCount is null but shows Following and Followers', async () => {
    mockGetProfileData.mockResolvedValue({
      person: {
        id: 'https://blob.cat/users/critical',
        preferredUsername: 'critical',
        summary: ''
      } as never,
      statusesCount: null,
      followingCount: 424,
      followersCount: 524,
      statuses: [],
      statusPagination: { nextPageUrl: null, prevPageUrl: null },
      attachments: [],
      isInternalAccount: false,
      hasFitnessData: false
    })

    const element = await Page({
      params: Promise.resolve({ actor: '@critical@blob.cat' })
    })
    render(element)

    expect(screen.queryByText('Posts')).not.toBeInTheDocument()
    expect(screen.getByText('424')).toBeInTheDocument()
    expect(screen.getByText('Following')).toBeInTheDocument()
    expect(screen.getByText('524')).toBeInTheDocument()
    expect(screen.getByText('Followers')).toBeInTheDocument()
  })

  it('renders 0 Posts when statusesCount is 0', async () => {
    mockGetProfileData.mockResolvedValue({
      person: {
        id: 'https://llun.social/users/testuser',
        preferredUsername: 'testuser',
        summary: ''
      } as never,
      statusesCount: 0,
      followingCount: 5,
      followersCount: 10,
      statuses: [],
      statusPagination: { nextPageUrl: null, prevPageUrl: null },
      attachments: [],
      isInternalAccount: true,
      hasFitnessData: false
    })

    const element = await Page({
      params: Promise.resolve({ actor: '@testuser@llun.social' })
    })
    render(element)

    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('Posts')).toBeInTheDocument()
  })

  it('omits the entire counts row when all counts are null', async () => {
    mockGetProfileData.mockResolvedValue({
      person: {
        id: 'https://llun.social/users/testuser',
        preferredUsername: 'testuser',
        summary: ''
      } as never,
      statusesCount: null,
      followingCount: null,
      followersCount: null,
      statuses: [],
      statusPagination: { nextPageUrl: null, prevPageUrl: null },
      attachments: [],
      isInternalAccount: false,
      hasFitnessData: false
    })

    const element = await Page({
      params: Promise.resolve({ actor: '@testuser@llun.social' })
    })
    render(element)

    expect(screen.queryByText('Posts')).not.toBeInTheDocument()
    expect(screen.queryByText('Following')).not.toBeInTheDocument()
    expect(screen.queryByText('Followers')).not.toBeInTheDocument()
  })
})
