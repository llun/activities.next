import { NextRequest } from 'next/server'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import { hashToken } from '@/lib/services/guards/OAuthGuard'
import {
  EXPECTED_ACTOR_HEADER,
  EXPECTED_ACTOR_MISMATCH_ERROR
} from '@/lib/services/statuses/expectedActor'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'

import { POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: Database | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', () => ({
  verifyBearerToken: vi.fn()
}))

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

describe('POST /api/v1/statuses Activities-Expected-Actor', () => {
  const testDb = createTestDatabase()
  const { database, db, prepare } = testDb

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  const post = ({
    status,
    expectedActor,
    idempotencyKey,
    body,
    headers = {}
  }: {
    status?: string
    expectedActor?: string
    idempotencyKey?: string
    body?: string
    headers?: Record<string, string>
  }) =>
    POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: body ?? JSON.stringify({ status }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test',
          ...(expectedActor === undefined
            ? {}
            : { [EXPECTED_ACTOR_HEADER]: expectedActor }),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
          ...headers
        }
      }),
      { params: Promise.resolve({}) }
    )

  const statusesWithText = async (text: string) => {
    const statuses = [
      ...(await database.getActorStatuses({ actorId: ACTOR1_ID })),
      ...(await database.getActorStatuses({ actorId: ACTOR2_ID }))
    ]
    return statuses.filter((status) => 'text' in status && status.text === text)
  }

  const claimFor = (actorId: string, key: string) =>
    database.getIdempotencyKey({ actorId, key })

  it.each([
    { description: 'absent', expectedActor: undefined },
    { description: 'the current actor', expectedActor: ACTOR1_ID },
    { description: 'whitespace only', expectedActor: '   ' }
  ])(
    'creates the status when the header is $description',
    async ({ description, expectedActor }) => {
      const text = `Expected actor ${description}`
      const response = await post({ status: text, expectedActor })

      expect(response.status).toBe(200)
      await expect(statusesWithText(text)).resolves.toHaveLength(1)
    }
  )

  it('answers 409 and writes no status and no idempotency claim for a different actor', async () => {
    const text = 'Written as another profile'
    const key = 'expected-actor-mismatch'

    const response = await post({
      status: text,
      expectedActor: ACTOR2_ID,
      idempotencyKey: key
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: EXPECTED_ACTOR_MISMATCH_ERROR
    })
    await expect(statusesWithText(text)).resolves.toHaveLength(0)
    await expect(claimFor(ACTOR1_ID, key)).resolves.toBeNull()
    await expect(claimFor(ACTOR2_ID, key)).resolves.toBeNull()
  })

  it('answers 409, not the replay, when the current actor already claimed the key', async () => {
    const text = 'Claimed then resent as another profile'
    const key = 'expected-actor-claimed'
    const first = await post({ status: text, idempotencyKey: key })
    expect(first.status).toBe(200)

    const resent = await post({
      status: text,
      expectedActor: ACTOR2_ID,
      idempotencyKey: key
    })

    expect(resent.status).toBe(409)
    await expect(resent.json()).resolves.toEqual({
      error: EXPECTED_ACTOR_MISMATCH_ERROR
    })
    await expect(statusesWithText(text)).resolves.toHaveLength(1)
    await expect(claimFor(ACTOR2_ID, key)).resolves.toBeNull()
  })

  it('checks the header before the Idempotency-Key length and the body', async () => {
    const tooLong = await post({
      status: 'Too long',
      expectedActor: ACTOR2_ID,
      idempotencyKey: 'k'.repeat(256)
    })
    expect(tooLong.status).toBe(409)

    const notJson = await post({ body: '{not json', expectedActor: ACTOR2_ID })
    expect(notJson.status).toBe(409)

    const emptyStatus = await post({ status: '', expectedActor: ACTOR2_ID })
    expect(emptyStatus.status).toBe(409)
  })

  it('applies to a bearer-token request as well', async () => {
    await db
      .insertInto('oauthClient')
      .values({
        id: 'expected-actor-client-row',
        clientId: 'expected-actor-client',
        name: 'Expected Actor App',
        uri: null,
        redirectUris: JSON.stringify(['https://app.example.com/callback']),
        scopes: JSON.stringify(['write'])
      })
      .execute()
    await db
      .insertInto('oauthAccessToken')
      .values({
        id: 'expected-actor-token',
        token: hashToken('expected-actor-write-token'),
        clientId: 'expected-actor-client',
        referenceId: ACTOR1_ID,
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['write'])
      })
      .execute()
    const headers = { Authorization: 'Bearer expected-actor-write-token' }
    mockGetServerSession.mockResolvedValue(null)

    const mismatch = await post({
      status: 'Bearer mismatch',
      expectedActor: ACTOR2_ID,
      headers
    })
    expect(mismatch.status).toBe(409)
    await expect(statusesWithText('Bearer mismatch')).resolves.toHaveLength(0)

    const match = await post({
      status: 'Bearer match',
      expectedActor: ACTOR1_ID,
      headers
    })
    expect(match.status).toBe(200)
    await expect(statusesWithText('Bearer match')).resolves.toHaveLength(1)
  })
})
