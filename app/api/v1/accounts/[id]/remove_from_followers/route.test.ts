import { NextRequest } from 'next/server'

import { rejectFollow } from '@/lib/activities'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
import { urlToId } from '@/lib/utils/urlToId'

import { POST } from './route'

jest.mock('@/lib/activities', () => ({ rejectFollow: jest.fn() }))

const mockGetServerSession = jest.fn()
jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => undefined
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    get: jest.fn().mockReturnValue(undefined)
  })
}))

jest.mock('better-auth/oauth2', () => ({ verifyAccessToken: jest.fn() }))

jest.mock('@/lib/config', () => ({
  getBaseURL: jest.fn().mockReturnValue('https://llun.test'),
  getConfig: jest.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const createRequest = (targetId: string) =>
  new NextRequest(
    `https://llun.test/api/v1/accounts/${urlToId(targetId)}/remove_from_followers`,
    { method: 'POST', headers: { origin: 'https://llun.test' } }
  )

describe('POST /api/v1/accounts/:id/remove_from_followers', () => {
  const database = getTestSQLDatabase()
  const rejectFollowMock = rejectFollow as jest.Mock

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
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })
  })

  it('removes a remote follower and federates a Reject', async () => {
    // EXTERNAL_ACTOR1 (llun.dev) follows Actor2 (llun.test) in the seed.
    const response = await POST(createRequest(EXTERNAL_ACTOR1), {
      params: Promise.resolve({ id: urlToId(EXTERNAL_ACTOR1) })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.followed_by).toBe(false)
    expect(rejectFollowMock).toHaveBeenCalledTimes(1)

    const follow = await database.getAcceptedOrRequestedFollow({
      actorId: EXTERNAL_ACTOR1,
      targetActorId: ACTOR2_ID
    })
    expect(follow).toBeNull()
  })

  it('removes a local follower without federating', async () => {
    // Actor3 (llun.test) follows Actor2 in the seed; same domain -> no Reject.
    const response = await POST(createRequest(ACTOR3_ID), {
      params: Promise.resolve({ id: urlToId(ACTOR3_ID) })
    })

    expect(response.status).toBe(200)
    expect(rejectFollowMock).not.toHaveBeenCalled()
  })

  it('is a no-op (200) when the account is not a follower', async () => {
    const stranger = 'https://llun.test/users/test4'
    const response = await POST(createRequest(stranger), {
      params: Promise.resolve({ id: urlToId(stranger) })
    })
    expect(response.status).toBe(200)
    expect(rejectFollowMock).not.toHaveBeenCalled()
  })
})
