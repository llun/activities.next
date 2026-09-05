import { type ReactNode, isValidElement } from 'react'

import { MainPageTimeline } from '@/app/(timeline)/MainPageTimeline'
import { Landing } from '@/app/(timeline)/landing/Landing'
import { Timeline } from '@/lib/services/timelines/types'
import { Actor } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'

import Page from './page'

const findElementByType = (
  node: ReactNode,
  type: unknown
): { props: Record<string, unknown> } | null => {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElementByType(child, type)
      if (found) return found
    }
    return null
  }
  if (!isValidElement(node)) return null
  if (node.type === type) return node as { props: Record<string, unknown> }
  const props = node.props as { children?: ReactNode }
  return findElementByType(props?.children, type)
}

const mockGetConfig = vi.fn()
const mockGetDatabase = vi.fn()
const mockGetResolvedServerSettings = vi.fn()
const mockGetServerAuthSession = vi.fn()
const mockGetActorFromSession = vi.fn()
const mockGetCachedLocalPublicStatusesCount = vi.fn()
const mockGetFilteredStatusPage = vi.fn()
const mockGetFilteredTimelinePage = vi.fn()
const mockGetActorSettings = vi.fn()
const mockLoggerError = vi.fn()

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
    info: vi.fn(),
    warn: vi.fn()
  }
}))

vi.mock('@/lib/config', () => ({
  getConfig: () => mockGetConfig()
}))

vi.mock('@/lib/database', () => ({
  getDatabase: () => mockGetDatabase()
}))

vi.mock('@/lib/services/serverSettings', () => ({
  getResolvedServerSettings: () => mockGetResolvedServerSettings()
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerAuthSession()
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: (...args: unknown[]) => mockGetActorFromSession(...args)
}))

vi.mock('@/lib/services/timelines/localPublicCount', () => ({
  getCachedLocalPublicStatusesCount: (...args: unknown[]) =>
    mockGetCachedLocalPublicStatusesCount(...args)
}))

vi.mock('@/lib/services/timelines/getFilteredTimelinePage', () => ({
  getFilteredStatusPage: (...args: unknown[]) =>
    mockGetFilteredStatusPage(...args),
  getFilteredTimelinePage: (...args: unknown[]) =>
    mockGetFilteredTimelinePage(...args)
}))

const mockActor: Actor = {
  id: 'https://llun.social/users/testuser',
  username: 'testuser',
  domain: 'llun.social',
  name: 'Test User',
  summary: '',
  followersUrl: 'https://llun.social/users/testuser/followers',
  inboxUrl: 'https://llun.social/users/testuser/inbox',
  sharedInboxUrl: 'https://llun.social/inbox',
  publicKey: 'pubkey',
  followingCount: 10,
  followersCount: 20,
  statusCount: 30,
  lastStatusAt: Date.now(),
  createdAt: Date.now(),
  updatedAt: Date.now()
}

const mockStatus: Status = {
  id: 'https://llun.social/users/testuser/statuses/1',
  url: 'https://llun.social/users/testuser/statuses/1',
  actorId: mockActor.id,
  actor: null,
  type: 'Note',
  text: 'Hello world',
  summary: null,
  reply: '',
  replies: [],
  totalReplies: 0,
  actorAnnounceStatusId: null,
  isActorLiked: false,
  isActorBookmarked: false,
  totalLikes: 0,
  totalShares: 0,
  to: ['https://www.w3.org/ns/activitystreams#Public'],
  cc: [],
  edits: [],
  attachments: [],
  tags: [],
  isLocalActor: true,
  createdAt: Date.now(),
  updatedAt: Date.now()
}

describe('(timeline)/(home) page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConfig.mockReturnValue({
      host: 'llun.social',
      serviceName: 'Activities',
      mediaStorage: {}
    })
    mockGetDatabase.mockReturnValue({
      getActorSettings: mockGetActorSettings,
      getTimeline: vi.fn()
    })
    mockGetResolvedServerSettings.mockResolvedValue({
      registrations: { open: true }
    })
    mockGetServerAuthSession.mockResolvedValue(null)
    mockGetActorFromSession.mockResolvedValue(null)
    mockGetCachedLocalPublicStatusesCount.mockResolvedValue(0)
    mockGetFilteredStatusPage.mockResolvedValue({ statuses: [] })
    mockGetFilteredTimelinePage.mockResolvedValue({
      statuses: [mockStatus],
      nextMaxStatusId: 'next-123'
    })
    mockGetActorSettings.mockResolvedValue({ postLineLimit: 5 })
  })

  it('renders Landing for logged-out visitors with preview posts when above threshold', async () => {
    mockGetCachedLocalPublicStatusesCount.mockResolvedValue(100)
    mockGetFilteredStatusPage.mockResolvedValue({ statuses: [mockStatus] })

    const node = await Page()
    const landing = findElementByType(node, Landing)

    expect(landing).not.toBeNull()
    expect(landing?.props.host).toBe('llun.social')
    expect(landing?.props.serviceName).toBe('Activities')
    expect(landing?.props.signupOpen).toBe(true)
    expect(landing?.props.statuses).toHaveLength(1)
    expect(mockGetFilteredStatusPage).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 20,
        surface: 'public'
      })
    )
  })

  it('renders Landing for logged-out visitors without preview posts when below threshold', async () => {
    mockGetCachedLocalPublicStatusesCount.mockResolvedValue(50)

    const node = await Page()
    const landing = findElementByType(node, Landing)

    expect(landing).not.toBeNull()
    expect(landing?.props.statuses).toHaveLength(0)
    expect(mockGetFilteredStatusPage).not.toHaveBeenCalled()
  })

  it('degrades to Landing without posts and logs error when fetching public posts fails', async () => {
    mockGetCachedLocalPublicStatusesCount.mockRejectedValue(
      new Error('Database timeout')
    )

    const node = await Page()
    const landing = findElementByType(node, Landing)

    expect(landing).not.toBeNull()
    expect(landing?.props.statuses).toHaveLength(0)
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to load public posts for the landing page'
      })
    )
  })

  it('renders MainPageTimeline for signed-in actors', async () => {
    mockGetActorFromSession.mockResolvedValue(mockActor)

    const node = await Page()
    const timeline = findElementByType(node, MainPageTimeline)

    expect(timeline).not.toBeNull()
    expect(timeline?.props.host).toBe('llun.social')
    expect(timeline?.props.initialNextMaxStatusId).toBe('next-123')
    expect(timeline?.props.isMediaUploadEnabled).toBe(true)
    expect(timeline?.props.postLineLimit).toBe(5)
    expect(timeline?.props.statuses).toHaveLength(1)
    expect(mockGetFilteredTimelinePage).toHaveBeenCalledWith({
      database: expect.anything(),
      timeline: Timeline.MAIN,
      actorId: mockActor.id
    })
  })
})
