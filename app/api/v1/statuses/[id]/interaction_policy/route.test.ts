import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { SEND_UPDATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

import { PUT } from './route'

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
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', () => ({
  verifyAccessToken: vi.fn()
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

const putRequest = (encodedId: string, body: unknown) =>
  new NextRequest(
    `https://llun.test/api/v1/statuses/${encodedId}/interaction_policy`,
    {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://llun.test'
      }
    }
  )

describe('PUT /api/v1/statuses/[id]/interaction_policy', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    if (!database) return
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  it('sets who may quote the status without recording an edit and re-federates', async () => {
    const statusId = `${ACTOR1_ID}/statuses/interaction-policy-1`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR1_ID,
      text: 'my post',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    const response = await PUT(
      putRequest(urlToId(statusId), { quote_approval_policy: 'followers' }),
      { params: Promise.resolve({ id: urlToId(statusId) }) }
    )

    expect(response.status).toBe(200)
    const status = await response.json()
    expect(status.quote_approval.automatic).toEqual(['followers'])
    // Changing the interaction policy is not an edit — edited_at must stay null.
    expect(status.edited_at).toBeNull()
    expect(getQueue().publish).toHaveBeenCalledWith(
      expect.objectContaining({ name: SEND_UPDATE_NOTE_JOB_NAME })
    )
  })

  it('returns 403 when the caller is not the status author', async () => {
    const statusId = `${ACTOR2_ID}/statuses/interaction-policy-not-mine`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR2_ID,
      text: 'someone elses post',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    const response = await PUT(
      putRequest(urlToId(statusId), { quote_approval_policy: 'nobody' }),
      { params: Promise.resolve({ id: urlToId(statusId) }) }
    )

    expect(response.status).toBe(403)
    expect(getQueue().publish).not.toHaveBeenCalled()
  })

  it('returns 422 for an invalid quote_approval_policy value', async () => {
    const statusId = `${ACTOR1_ID}/statuses/interaction-policy-invalid`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR1_ID,
      text: 'my post',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    const response = await PUT(
      putRequest(urlToId(statusId), { quote_approval_policy: 'everyone' }),
      { params: Promise.resolve({ id: urlToId(statusId) }) }
    )

    expect(response.status).toBe(422)
  })
})
