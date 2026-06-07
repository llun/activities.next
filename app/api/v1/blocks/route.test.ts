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

describe('GET /api/v1/blocks', () => {
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
  const createBlock = async (targetActorId: string) => {
    createdTargets.push(targetActorId)
    await database.createBlock({
      actorId: ACTOR1_ID,
      targetActorId,
      uri: `${ACTOR1_ID}#blocks/${encodeURIComponent(targetActorId)}`
    })
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockStoredTokens.clear()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  afterEach(async () => {
    while (createdTargets.length > 0) {
      const targetActorId = createdTargets.pop()
      if (targetActorId) {
        await database.deleteBlock({ actorId: ACTOR1_ID, targetActorId })
      }
    }
  })

  const createRequest = (query = '') =>
    new NextRequest(`https://llun.test/api/v1/blocks${query}`)

  const setToken = (token: string, scopes: string[]) => {
    mockStoredTokens.set(hashToken(token), {
      token: hashToken(token),
      referenceId: ACTOR1_ID,
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
  // `read:blocks` scope; an unrelated granular read scope must be rejected.
  it.each(['read', 'read:blocks'])(
    'accepts a token holding the %s scope',
    async (scope) => {
      mockGetServerSession.mockResolvedValue(null)
      setToken('blocks-token', [scope])

      const response = await GET(
        new NextRequest('https://llun.test/api/v1/blocks', {
          headers: { Authorization: 'Bearer blocks-token' }
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
      new NextRequest('https://llun.test/api/v1/blocks', {
        headers: { Authorization: 'Bearer statuses-token' }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(401)
  })

  it('returns Mastodon accounts for blocked actors', async () => {
    await createBlock(ACTOR2_ID)

    const response = await GET(createRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toContainEqual(expect.objectContaining({ url: ACTOR2_ID }))
  })

  it('emits a Link header with max_id when the page is full', async () => {
    const remoteA = 'https://remote.test/users/list-block-link-a'
    const remoteB = 'https://remote.test/users/list-block-link-b'
    for (const target of [remoteA, remoteB]) {
      await createBlock(target)
    }

    const response = await GET(createRequest('?limit=1'), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(200)
    const linkHeader = response.headers.get('Link')
    expect(linkHeader).toContain('rel="next"')
    expect(linkHeader).toContain('max_id=')
  })
})
