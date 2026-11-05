import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { GET } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    host: 'llun.test',
    secretPhase: 'test-secret-for-encryption',
    allowEmails: [],
    allowActorDomains: []
  })
}))

type MockDatabase = Pick<
  Database,
  | 'getFitnessPersonalRecords'
  | 'getStatusesByIds'
  | 'getAccountFromEmail'
  | 'getActorsForAccount'
  | 'getActorFromId'
>

let mockDatabase: MockDatabase | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined })
}))

describe('GET /api/v1/fitness/records', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getFitnessPersonalRecords: vi.fn(),
    getStatusesByIds: vi.fn(),
    getAccountFromEmail: vi.fn(),
    getActorsForAccount: vi.fn(),
    getActorFromId: vi.fn()
  }

  const mockAccount = {
    id: 'account-1',
    email: seedActor1.email,
    defaultActorId: ACTOR1_ID,
    twoFactorEnabled: false,
    emailVerified: true,
    createdAt: 1000,
    updatedAt: 1000
  }

  const mockActor = {
    ...seedActor1,
    id: ACTOR1_ID,
    followersUrl: `${ACTOR1_ID}/followers`,
    inboxUrl: `${ACTOR1_ID}/inbox`,
    sharedInboxUrl: 'https://llun.test/inbox',
    statusCount: 0,
    lastStatusAt: null,
    createdAt: 1000,
    updatedAt: 1000,
    account: mockAccount
  }

  beforeAll(() => {
    mockDatabase = mockDb
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    mockDb.getAccountFromEmail.mockResolvedValue(mockAccount)
    mockDb.getActorsForAccount.mockResolvedValue([mockActor])
    mockDb.getActorFromId.mockResolvedValue(mockActor)
    mockDb.getFitnessPersonalRecords.mockResolvedValue([])
    mockDb.getStatusesByIds.mockResolvedValue([])
  })

  const get = (query = '') =>
    GET(new NextRequest(`http://llun.test/api/v1/fitness/records${query}`), {
      params: Promise.resolve({})
    })

  it('sends a signed-out request to sign in and reads nothing', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const response = await get('?range=all')

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/auth/signin')
    expect(mockDb.getFitnessPersonalRecords).not.toHaveBeenCalled()
  })

  describe('with the clock at 5 November 2026', () => {
    const NOW = Date.UTC(2026, 10, 5, 12, 30)

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(NOW)
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('reads the last 90 days of the signed-in actor’s own records', async () => {
      const response = await get('?range=90d')
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(mockDb.getFitnessPersonalRecords).toHaveBeenCalledTimes(1)
      expect(mockDb.getFitnessPersonalRecords).toHaveBeenCalledWith({
        actorId: ACTOR1_ID,
        since: NOW - 90 * 24 * 60 * 60 * 1000
      })
      expect(body.range).toBe('90d')
      expect(body.power).toHaveLength(5)
      expect(body.distance).toHaveLength(5)
    })

    it('reads this year from 1 January UTC', async () => {
      const response = await get('?range=year')

      expect(response.status).toBe(200)
      expect(mockDb.getFitnessPersonalRecords).toHaveBeenCalledWith({
        actorId: ACTOR1_ID,
        since: Date.UTC(2026, 0, 1)
      })
      expect((await response.json()).range).toBe('year')
    })
  })

  it('ignores any actor named in the query and reads the session actor', async () => {
    const other = encodeURIComponent('https://llun.test/users/other')
    const response = await get(
      `?range=all&actorId=${other}&actor_id=${other}&id=${other}`
    )

    expect(response.status).toBe(200)
    expect(mockDb.getFitnessPersonalRecords).toHaveBeenCalledTimes(1)
    expect(mockDb.getFitnessPersonalRecords).toHaveBeenCalledWith({
      actorId: ACTOR1_ID,
      since: null
    })
  })

  it('defaults to all time', async () => {
    await get()
    expect(mockDb.getFitnessPersonalRecords).toHaveBeenCalledWith({
      actorId: ACTOR1_ID,
      since: null
    })
  })

  it('refuses an unknown range', async () => {
    const response = await get('?range=week')
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Bad Request' })
    expect(mockDb.getFitnessPersonalRecords).not.toHaveBeenCalled()
  })
})
