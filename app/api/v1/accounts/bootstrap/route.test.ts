import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { Actor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'

import { GET, OPTIONS } from './route'

const mockConfig = {
  host: 'llun.test',
  mediaStorage: { type: 'fs', path: '/tmp/uploads' }
}

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => mockConfig)
}))

const mockServerSettings = {
  posts: {
    maxCharacters: 500,
    maxMediaAttachments: 4
  },
  media: {
    maxFileSize: 10485760
  },
  polls: {
    maxOptions: 4,
    maxCharactersPerOption: 50,
    minExpirationSeconds: 300,
    maxExpirationSeconds: 2592000
  },
  features: {
    fitness: true
  }
}

vi.mock('@/lib/services/serverSettings', () => ({
  getResolvedServerSettings: vi.fn(async () => mockServerSettings)
}))

let mockCurrentActor: Actor
let mockDatabase: {
  getActorsForAccount: ReturnType<typeof vi.fn>
  getNotificationsCount: ReturnType<typeof vi.fn>
  getLists: ReturnType<typeof vi.fn>
  getActorSettings: ReturnType<typeof vi.fn>
}

vi.mock('@/lib/services/guards/OAuthGuard', () => ({
  OAuthGuardAnyScope:
    (
      _scopes: unknown,
      handle: (
        req: NextRequest,
        context: {
          database: typeof mockDatabase
          currentActor: typeof mockCurrentActor
          params: Promise<unknown>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<unknown> }) =>
      handle(req, {
        database: mockDatabase,
        currentActor: mockCurrentActor,
        params: context.params
      })
}))

describe('GET /api/v1/accounts/bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getConfig).mockReturnValue(
      mockConfig as unknown as ReturnType<typeof getConfig>
    )
    vi.mocked(getResolvedServerSettings).mockResolvedValue(
      mockServerSettings as unknown as Awaited<
        ReturnType<typeof getResolvedServerSettings>
      >
    )

    mockCurrentActor = {
      id: 'https://llun.test/users/alice',
      username: 'alice',
      domain: 'llun.test',
      name: 'Alice Cooper',
      iconUrl: 'https://llun.test/uploads/alice.png',
      headerImageUrl: 'https://llun.test/uploads/header.png',
      summary: 'Hello world',
      followersUrl: 'https://llun.test/users/alice/followers',
      inboxUrl: 'https://llun.test/users/alice/inbox',
      sharedInboxUrl: 'https://llun.test/inbox',
      followingCount: 10,
      followersCount: 20,
      statusCount: 30,
      lastStatusAt: 1700000000000,
      createdAt: 1690000000000,
      updatedAt: 1700000000000,
      publicKey: 'mock-key',
      account: {
        id: 'acc-1',
        email: 'alice@llun.test',
        role: 'admin',
        createdAt: 1690000000000,
        updatedAt: 1700000000000
      }
    } as Actor

    mockDatabase = {
      getActorsForAccount: vi.fn().mockResolvedValue([
        {
          id: 'https://llun.test/users/alice',
          username: 'alice',
          domain: 'llun.test',
          name: 'Alice Cooper',
          iconUrl: 'https://llun.test/uploads/alice.png',
          deletionStatus: null,
          deletionScheduledAt: null
        },
        {
          id: 'https://llun.test/users/alice_alt',
          username: 'alice_alt',
          domain: 'llun.test',
          name: 'Alice Alt',
          iconUrl: null,
          deletionStatus: 'scheduled',
          deletionScheduledAt: 1710000000000
        }
      ]),
      getNotificationsCount: vi.fn().mockResolvedValue(7),
      getLists: vi.fn().mockResolvedValue([
        {
          id: 'list-1',
          title: 'Close Friends',
          actorId: 'https://llun.test/users/alice'
        }
      ]),
      getActorSettings: vi.fn().mockResolvedValue({
        navOrder: ['home', 'explore', 'lists'],
        navHidden: ['bookmarks'],
        readingAutoplayGifs: true,
        postLineLimit: 12,
        readingGroupBoosts: false
      })
    }
  })

  it('returns complete snapshot for authenticated session actor', async () => {
    const req = new NextRequest('https://llun.test/api/v1/accounts/bootstrap')
    const res = await GET(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(200)
    const data = await res.json()

    expect(data.accountId).toBe('acc-1')
    expect(data.actorId).toBe('https://llun.test/users/alice')
    expect(data.host).toBe('llun.test')
    expect(data.mediaStorage).toBeUndefined()
    expect(data.instanceLimits).toEqual({
      maxStatusCharacters: 500,
      maxMediaFileSize: 10485760,
      maxMediaAttachments: 4,
      maxPollOptions: 4,
      maxPollOptionCharacters: 50,
      minPollExpirationSeconds: 300,
      maxPollExpirationSeconds: 2592000
    })
    expect(data.features).toEqual({ fitness: true })

    expect(data.actors).toEqual([
      {
        id: 'https://llun.test/users/alice',
        username: 'alice',
        domain: 'llun.test',
        name: 'Alice Cooper',
        iconUrl: 'https://llun.test/uploads/alice.png',
        deletionStatus: null,
        deletionScheduledAt: null
      },
      {
        id: 'https://llun.test/users/alice_alt',
        username: 'alice_alt',
        domain: 'llun.test',
        name: 'Alice Alt',
        iconUrl: null,
        deletionStatus: 'scheduled',
        deletionScheduledAt: 1710000000000
      }
    ])

    expect(data.unreadCount).toBe(7)
    expect(mockDatabase.getNotificationsCount).toHaveBeenCalledWith({
      actorId: 'https://llun.test/users/alice',
      onlyUnread: true
    })

    expect(data.lists).toEqual([{ id: 'list-1', title: 'Close Friends' }])

    expect(data.navOrder).toEqual(['home', 'explore', 'lists'])
    expect(data.navHidden).toEqual(['bookmarks'])
    expect(data.readingAutoplayGifs).toBe(true)
    expect(data.postLineLimit).toBe(12)
    expect(data.readingGroupBoosts).toBe(false)

    expect(data.user).toEqual({
      name: 'Alice Cooper',
      username: 'alice',
      handle: '@alice@llun.test',
      avatarUrl: 'https://llun.test/uploads/alice.png'
    })

    expect(data.currentActor).toEqual({
      id: 'https://llun.test/users/alice',
      username: 'alice',
      domain: 'llun.test',
      name: 'Alice Cooper',
      iconUrl: 'https://llun.test/uploads/alice.png'
    })

    expect(data.profile).toBeDefined()
    expect(data.profile.username).toBe('alice')
    expect(data.fitnessUrl).toBe('/fitness')
    expect(data.galleryUrl).toBe('/gallery')
    expect(data.isAdmin).toBe(true)
    expect(data.isMediaUploadEnabled).toBe(true)
    expect(typeof data.currentTime).toBe('number')
    expect(typeof data.savedAt).toBe('number')
  })

  it('handles user without custom actorSettings using sensible defaults', async () => {
    mockDatabase.getActorSettings.mockResolvedValue(null)
    const req = new NextRequest('https://llun.test/api/v1/accounts/bootstrap')
    const res = await GET(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(200)
    const data = await res.json()

    expect(data.navOrder).toBeUndefined()
    expect(data.navHidden).toBeUndefined()
    expect(data.readingAutoplayGifs).toBe(false)
    expect(data.postLineLimit).toBeUndefined()
    expect(data.readingGroupBoosts).toBe(true)
  })

  it('sets isAdmin to false and fitnessUrl to undefined when non-admin and fitness disabled', async () => {
    mockCurrentActor = {
      ...mockCurrentActor,
      account: {
        ...mockCurrentActor.account!,
        role: 'user'
      }
    }
    vi.mocked(getResolvedServerSettings).mockResolvedValueOnce({
      ...mockServerSettings,
      features: { fitness: false }
    } as unknown as Awaited<ReturnType<typeof getResolvedServerSettings>>)

    const req = new NextRequest('https://llun.test/api/v1/accounts/bootstrap')
    const res = await GET(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(200)
    const data = await res.json()

    expect(data.isAdmin).toBe(false)
    expect(data.fitnessUrl).toBeUndefined()
  })

  it('rejects with 401 when currentActor has no account', async () => {
    mockCurrentActor = {
      ...mockCurrentActor,
      account: undefined
    }

    const req = new NextRequest('https://llun.test/api/v1/accounts/bootstrap')
    const res = await GET(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data).toEqual({ error: 'Unauthorized' })
  })

  it('returns 500 when database throws', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {})
    mockDatabase.getActorsForAccount.mockRejectedValueOnce(
      new Error('Database connection failed')
    )

    const req = new NextRequest('https://llun.test/api/v1/accounts/bootstrap')
    const res = await GET(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data).toEqual({ error: 'Internal Server Error' })
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('responds to OPTIONS with CORS headers', async () => {
    const req = new NextRequest('https://llun.test/api/v1/accounts/bootstrap', {
      method: 'OPTIONS'
    })
    const res = await OPTIONS(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET')
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('OPTIONS')
  })
})
