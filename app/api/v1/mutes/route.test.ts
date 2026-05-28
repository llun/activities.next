import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'

import { GET } from './route'

const mockGetServerSession = jest.fn()
jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
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
  const createMute = async (targetActorId: string) => {
    createdTargets.push(targetActorId)
    await database.createMute({
      actorId: ACTOR1_ID,
      targetActorId,
      notifications: true,
      endsAt: null
    })
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

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
})
