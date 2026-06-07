import crypto from 'crypto'
import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR4_ID, seedActor4 } from '@/lib/stub/seed/actor4'
import { ACTOR5_ID } from '@/lib/stub/seed/actor5'
import { FollowStatus } from '@/lib/types/domain/follow'

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

const mockGetServerSession = jest.fn()
jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => (_table: string) => ({
    where: (_field: string, value: string) => ({
      first: () => Promise.resolve(mockStoredTokens.get(value) ?? null)
    })
  })
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    get: jest.fn().mockReturnValue(undefined)
  })
}))

jest.mock('better-auth/oauth2', () => ({
  verifyAccessToken: jest.fn()
}))

jest.mock('@/lib/config', () => ({
  getBaseURL: jest.fn().mockReturnValue('https://llun.test'),
  getConfig: jest.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

describe('GET /api/v1/follow_requests', () => {
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

  // actor4 starts with no pending follow requests (seedDatabase only gives it an
  // accepted follower), so it is a clean target to pin pagination behavior on.
  const createdFollowIds: string[] = []
  const createFollowRequest = async (actorId: string, createdAt?: Date) => {
    if (createdAt) jest.setSystemTime(createdAt)
    const follow = await database.createFollow({
      actorId,
      targetActorId: ACTOR4_ID,
      inbox: `${actorId}/inbox`,
      sharedInbox: 'https://llun.test/inbox',
      status: FollowStatus.enum.Requested
    })
    createdFollowIds.push(follow.id)
    return follow
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockStoredTokens.clear()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor4.email }
    })
  })

  afterEach(async () => {
    while (createdFollowIds.length > 0) {
      const followId = createdFollowIds.pop()
      if (followId) {
        await database.updateFollowStatus({
          followId,
          status: FollowStatus.enum.Rejected
        })
      }
    }
  })

  const createRequest = (query = '', token?: string) =>
    new NextRequest(`https://llun.test/api/v1/follow_requests${query}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    })

  const setToken = (token: string, scopes: string[]) => {
    mockStoredTokens.set(hashToken(token), {
      token: hashToken(token),
      referenceId: ACTOR4_ID,
      clientId: 'client-app-1',
      expiresAt: new Date(Date.now() + 3600000),
      scopes: JSON.stringify(scopes)
    })
  }

  it('requires authentication', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const response = await GET(createRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(401)
  })

  // The guard accepts EITHER the aggregate `read` scope OR the granular
  // `read:follows` scope; an unrelated granular read scope must be rejected.
  it.each(['read', 'read:follows'])(
    'accepts a token holding the %s scope',
    async (scope) => {
      mockGetServerSession.mockResolvedValue(null)
      setToken('follows-token', [scope])

      const response = await GET(createRequest('', 'follows-token'), {
        params: Promise.resolve({})
      })

      expect(response.status).toBe(200)
    }
  )

  it('rejects a token holding only an unrelated read scope', async () => {
    mockGetServerSession.mockResolvedValue(null)
    setToken('statuses-token', ['read:statuses'])

    const response = await GET(createRequest('', 'statuses-token'), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(401)
  })

  it('returns an empty array when there are no pending requests', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([])
    expect(response.headers.get('Link')).toBeNull()
  })

  it('returns pending follow requests as accounts newest first', async () => {
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask']
    })
    try {
      await createFollowRequest(ACTOR1_ID, new Date('2024-01-01T00:00:00Z'))
      await createFollowRequest(ACTOR2_ID, new Date('2024-01-01T00:01:00Z'))
    } finally {
      jest.useRealTimers()
    }

    const response = await GET(createRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.map((account: { url: string }) => account.url)).toEqual([
      ACTOR2_ID,
      ACTOR1_ID
    ])
  })

  it('paginates with Mastodon Link headers using follow ids', async () => {
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask']
    })
    try {
      await createFollowRequest(ACTOR1_ID, new Date('2024-01-01T00:00:00Z'))
      await createFollowRequest(ACTOR2_ID, new Date('2024-01-01T00:01:00Z'))
      await createFollowRequest(ACTOR5_ID, new Date('2024-01-01T00:02:00Z'))
    } finally {
      jest.useRealTimers()
    }

    const firstResponse = await GET(createRequest('?limit=2'), {
      params: Promise.resolve({})
    })
    expect(firstResponse.status).toBe(200)
    const firstPage = await firstResponse.json()
    expect(firstPage.map((account: { url: string }) => account.url)).toEqual([
      ACTOR5_ID,
      ACTOR2_ID
    ])

    const linkHeader = firstResponse.headers.get('Link')
    expect(linkHeader).toContain('rel="next"')
    expect(linkHeader).toContain('rel="prev"')

    const maxId = linkHeader?.match(/[?&]max_id=([^&>]+)/)?.[1]
    expect(maxId).toBeTruthy()

    const secondResponse = await GET(
      createRequest(`?limit=2&max_id=${maxId}`),
      {
        params: Promise.resolve({})
      }
    )
    expect(secondResponse.status).toBe(200)
    const secondPage = await secondResponse.json()
    expect(secondPage.map((account: { url: string }) => account.url)).toEqual([
      ACTOR1_ID
    ])
  })

  it('returns newer requests after a since_id cursor', async () => {
    const created: { id: string }[] = []
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask']
    })
    try {
      created.push(
        await createFollowRequest(ACTOR1_ID, new Date('2024-01-01T00:00:00Z'))
      )
      created.push(
        await createFollowRequest(ACTOR2_ID, new Date('2024-01-01T00:01:00Z'))
      )
      created.push(
        await createFollowRequest(ACTOR5_ID, new Date('2024-01-01T00:02:00Z'))
      )
    } finally {
      jest.useRealTimers()
    }

    const middleId = created[1].id
    const response = await GET(createRequest(`?since_id=${middleId}`), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.map((account: { url: string }) => account.url)).toEqual([
      ACTOR5_ID
    ])
  })

  it('returns an empty array for an unknown pagination cursor', async () => {
    await createFollowRequest(ACTOR1_ID)

    const response = await GET(createRequest('?max_id=does-not-exist'), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([])
  })
})
