import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { DELETE_ACTOR_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { JobMessage } from '@/lib/services/queue/type'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'

import { POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: () => undefined
  })
}))

vi.mock('better-auth/oauth2', () => ({
  verifyBearerToken: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    host: 'llun.test',
    allowEmails: [],
    secretPhase: 'test-secret'
  })
}))

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn()
}))

describe('POST /api/v1/actors/delete', () => {
  const database = getTestSQLDatabase()
  let published: JobMessage[]

  const useQueue = (runsInline: boolean) => {
    vi.mocked(getQueue).mockReturnValue({
      runsInline,
      publish: vi.fn(async (message: JobMessage) => {
        published.push(message)
      }),
      handle: vi.fn()
    } as unknown as ReturnType<typeof getQueue>)
  }

  const createSubActor = async (username: string) => {
    const account = await database.getAccountFromEmail({
      email: seedActor1.email
    })
    if (!account) throw new Error('Account not found')
    return database.createActorForAccount({
      accountId: account.id,
      username,
      domain: 'llun.test',
      publicKey: `${username}-public-key`,
      privateKey: `${username}-private-key`
    })
  }

  const deleteRequest = (body: unknown) =>
    new NextRequest('https://llun.test/api/v1/actors/delete', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://llun.test'
      },
      body: JSON.stringify(body)
    })

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    published = []
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  it('queues an immediate deletion at once', async () => {
    useQueue(false)
    const actorId = await createSubActor('delete-now')

    const response = await POST(deleteRequest({ actorId }), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    expect(published).toHaveLength(1)
    expect(published[0].name).toBe(DELETE_ACTOR_JOB_NAME)
    expect(published[0].delaySeconds).toBeUndefined()
  })

  it('queues a delayed deletion to fire when it comes due', async () => {
    useQueue(false)
    const actorId = await createSubActor('delete-later')

    const response = await POST(deleteRequest({ actorId, delayDays: 3 }), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    const status = await database.getActorDeletionStatus({ id: actorId })
    expect(status?.status).toBe('scheduled')
    expect(published).toHaveLength(1)
    expect(published[0].name).toBe(DELETE_ACTOR_JOB_NAME)
    expect(published[0].data).toEqual({
      actorId,
      scheduledAt: status?.scheduledAt
    })
    expect(published[0].delaySeconds).toBeGreaterThan(3 * 86400 - 10)
  })

  it('records a delayed deletion for the sweep under the in-process queue', async () => {
    useQueue(true)
    const actorId = await createSubActor('delete-sweep')

    const response = await POST(deleteRequest({ actorId, delayDays: 1 }), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    // The in-process queue would drop a delayed job, so none is published...
    expect(published).toEqual([])
    // ...and the deletion stays recorded as scheduled for the sweep to find.
    const status = await database.getActorDeletionStatus({ id: actorId })
    expect(status?.status).toBe('scheduled')
    expect(status?.scheduledAt).toBeGreaterThan(Date.now())
  })
})
