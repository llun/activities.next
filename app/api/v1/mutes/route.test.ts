import crypto from 'crypto'
import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'

import { GET } from './route'

const hashToken = (token: string) =>
  crypto
    .createHash('sha256')
    .update(token)
    .digest()
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

// Token store consulted by the guard's getKnex() lookup.
const mockStoredTokens = new Map<string, Record<string, unknown>>()

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => (_table: string) => ({
    where: (_field: string, value: string) => ({
      first: () => Promise.resolve(mockStoredTokens.get(value) ?? null)
    })
  })
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', () => ({
  verifyAccessToken: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

describe('GET /api/v1/mutes', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  const createdTargets: string[] = []
  const createMute = async (
    targetActorId: string,
    endsAt: number | null = null
  ) => {
    createdTargets.push(targetActorId)
    await database.createMute({
      actorId: ACTOR1_ID,
      targetActorId,
      notifications: true,
      endsAt
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockStoredTokens.clear()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  const setToken = (token: string, scopes: string[]) => {
    mockStoredTokens.set(hashToken(token), {
      token: hashToken(token),
      referenceId: ACTOR1_ID,
      clientId: 'client-app-1',
      expiresAt: new Date(Date.now() + 3600000),
      scopes: JSON.stringify(scopes)
    })
  }

  afterEach(async () => {
    while (createdTargets.length > 0) {
      const targetActorId = createdTargets.pop()
      if (targetActorId) {
        await database.deleteMute({ actorId: ACTOR1_ID, targetActorId })
      }
    }
  })

  const createRequest = (query = '') =>
    new NextRequest(`https://llun.test/api/v1/mutes${query}`)

  it('requires authentication', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const response = await GET(createRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(401)
  })

  // The guard accepts EITHER the aggregate `read` scope OR the granular
  // `read:mutes` scope; an unrelated granular read scope must be rejected.
  it.each(['read', 'read:mutes'])(
    'accepts a token holding the %s scope',
    async (scope) => {
      mockGetServerSession.mockResolvedValue(null)
      setToken('mutes-token', [scope])

      const response = await GET(
        new NextRequest('https://llun.test/api/v1/mutes', {
          headers: { Authorization: 'Bearer mutes-token' }
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
    }
  )

  it('rejects a token holding only an unrelated read scope', async () => {
    mockGetServerSession.mockResolvedValue(null)
    setToken('statuses-token', ['read:statuses'])

    const response = await GET(
      new NextRequest('https://llun.test/api/v1/mutes', {
        headers: { Authorization: 'Bearer statuses-token' }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(401)
  })

  it('returns an empty array when the actor has no mutes', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([])
    expect(response.headers.get('Link')).toBeNull()
  })

  it('returns Mastodon accounts for muted actors newest first', async () => {
    await createMute(ACTOR2_ID)

    const response = await GET(createRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveLength(1)
    expect(data[0]).toEqual(expect.objectContaining({ url: ACTOR2_ID }))
  })

  it('emits a Link header with max_id when the page is full', async () => {
    const remoteA = 'https://remote.test/users/list-mute-link-a'
    const remoteB = 'https://remote.test/users/list-mute-link-b'
    for (const target of [remoteA, remoteB]) {
      await createMute(target)
    }

    const response = await GET(createRequest('?limit=1'), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(200)
    const linkHeader = response.headers.get('Link')
    expect(linkHeader).toContain('rel="next"')
    expect(linkHeader).toContain('rel="prev"')
    expect(linkHeader).toContain('max_id=')
  })

  it('substitutes a fallback account when the muted actor cannot be hydrated', async () => {
    const orphanedTarget = 'https://remote.test/users/ghost-mute-target'
    await createMute(orphanedTarget)

    const response = await GET(createRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveLength(1)
    expect(data[0]).toEqual(
      expect.objectContaining({
        url: orphanedTarget,
        display_name: 'Account unavailable'
      })
    )
  })

  it('returns mute_expires_at from the stored expiry for a timed mute', async () => {
    await createMute(ACTOR2_ID, Date.UTC(2100, 0, 1))

    const response = await GET(createRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveLength(1)
    expect(data[0]).toEqual(
      expect.objectContaining({
        url: ACTOR2_ID,
        mute_expires_at: '2100-01-01T00:00:00.000Z'
      })
    )
  })

  it('returns mute_expires_at=null for an indefinite mute', async () => {
    await createMute(ACTOR2_ID)

    const response = await GET(createRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data[0]).toEqual(
      expect.objectContaining({ url: ACTOR2_ID, mute_expires_at: null })
    )
  })

  it('includes mute_expires_at on the fallback account', async () => {
    const orphanedTarget = 'https://remote.test/users/ghost-mute-target'
    await createMute(orphanedTarget, Date.UTC(2100, 5, 15, 8, 30, 0))

    const response = await GET(createRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data[0]).toEqual(
      expect.objectContaining({
        url: orphanedTarget,
        display_name: 'Account unavailable',
        mute_expires_at: '2100-06-15T08:30:00.000Z'
      })
    )
  })
})
