import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { PUBLISH_SCHEDULED_STATUS_JOB_NAME } from '@/lib/jobs/names'
import { SCHEDULED_AT_TOO_SOON_ERROR } from '@/lib/services/mastodon/constants'
import { getQueue } from '@/lib/services/queue'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ScheduledStatusParams } from '@/lib/types/mastodon/scheduledStatus'

import { DELETE, GET as GET_ID, PUT } from './[id]/route'
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

jest.mock('@/lib/services/queue', () => ({
  getQueue: jest.fn().mockReturnValue({
    publish: jest.fn().mockResolvedValue(undefined)
  })
}))

jest.mock('@/lib/config', () => ({
  getBaseURL: jest.fn().mockReturnValue('https://llun.test'),
  getConfig: jest.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const baseParams = (text: string): ScheduledStatusParams => ({
  text,
  poll: null,
  media_ids: null,
  sensitive: false,
  spoiler_text: null,
  visibility: 'public',
  in_reply_to_id: null,
  language: null,
  application_id: null,
  scheduled_at: null,
  idempotency: null,
  with_rate_limit: false
})

const tenMinutesAhead = () => Date.now() + 10 * 60 * 1000

describe('scheduled_statuses CRUD', () => {
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

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  it('lists the actor scheduled statuses', async () => {
    const created = await database.createScheduledStatus({
      actorId: ACTOR1_ID,
      scheduledAt: tenMinutesAhead(),
      params: baseParams('Listed scheduled status')
    })

    const response = await GET(
      new NextRequest('https://llun.test/api/v1/scheduled_statuses', {
        headers: { Origin: 'https://llun.test' }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    const list = await response.json()
    const match = list.find((item: { id: string }) => item.id === created.id)
    expect(match).toBeTruthy()
    expect(match.params.text).toBe('Listed scheduled status')
    expect(match.media_attachments).toEqual([])
  })

  it('returns a single scheduled status by id', async () => {
    const created = await database.createScheduledStatus({
      actorId: ACTOR1_ID,
      scheduledAt: tenMinutesAhead(),
      params: baseParams('Single scheduled status')
    })

    const response = await GET_ID(
      new NextRequest(
        `https://llun.test/api/v1/scheduled_statuses/${created.id}`,
        { headers: { Origin: 'https://llun.test' } }
      ),
      { params: Promise.resolve({ id: created.id }) }
    )

    expect(response.status).toBe(200)
    const scheduled = await response.json()
    expect(scheduled.id).toBe(created.id)
    expect(scheduled.params.text).toBe('Single scheduled status')
  })

  it('returns 404 for an unknown scheduled status id', async () => {
    const response = await GET_ID(
      new NextRequest(
        'https://llun.test/api/v1/scheduled_statuses/does-not-exist',
        { headers: { Origin: 'https://llun.test' } }
      ),
      { params: Promise.resolve({ id: 'does-not-exist' }) }
    )

    expect(response.status).toBe(404)
  })

  it('reschedules a scheduled status via PUT', async () => {
    const created = await database.createScheduledStatus({
      actorId: ACTOR1_ID,
      scheduledAt: tenMinutesAhead(),
      params: baseParams('Reschedule me')
    })
    const newScheduledAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()

    const response = await PUT(
      new NextRequest(
        `https://llun.test/api/v1/scheduled_statuses/${created.id}`,
        {
          method: 'PUT',
          body: JSON.stringify({ scheduled_at: newScheduledAt }),
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://llun.test'
          }
        }
      ),
      { params: Promise.resolve({ id: created.id }) }
    )

    expect(response.status).toBe(200)
    const updated = await response.json()
    expect(updated.scheduled_at).toBe(newScheduledAt)

    const stored = await database.getScheduledStatus({
      actorId: ACTOR1_ID,
      id: created.id
    })
    expect(stored?.scheduledAt).toBe(Date.parse(newScheduledAt))

    // The publish job is re-enqueued with the new delay so the status fires at
    // the rescheduled time.
    expect(getQueue().publish).toHaveBeenCalledTimes(1)
    expect(getQueue().publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: PUBLISH_SCHEDULED_STATUS_JOB_NAME,
        data: { scheduledStatusId: created.id },
        delaySeconds: expect.any(Number)
      })
    )
    const delaySeconds = (getQueue().publish as jest.Mock).mock.calls[0][0]
      .delaySeconds
    // ~30 minutes ahead, comfortably above the five-minute floor.
    expect(delaySeconds).toBeGreaterThan(20 * 60)
  })

  it('returns 422 when PUT scheduled_at is less than five minutes ahead', async () => {
    const created = await database.createScheduledStatus({
      actorId: ACTOR1_ID,
      scheduledAt: tenMinutesAhead(),
      params: baseParams('Too soon reschedule')
    })

    const response = await PUT(
      new NextRequest(
        `https://llun.test/api/v1/scheduled_statuses/${created.id}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            scheduled_at: new Date(Date.now() + 60 * 1000).toISOString()
          }),
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://llun.test'
          }
        }
      ),
      { params: Promise.resolve({ id: created.id }) }
    )

    expect(response.status).toBe(422)
    const error = await response.json()
    expect(error.error).toBe(SCHEDULED_AT_TOO_SOON_ERROR)
  })

  it('deletes a scheduled status and then 404s on lookup', async () => {
    const created = await database.createScheduledStatus({
      actorId: ACTOR1_ID,
      scheduledAt: tenMinutesAhead(),
      params: baseParams('Delete me')
    })

    const deleteResponse = await DELETE(
      new NextRequest(
        `https://llun.test/api/v1/scheduled_statuses/${created.id}`,
        { method: 'DELETE', headers: { Origin: 'https://llun.test' } }
      ),
      { params: Promise.resolve({ id: created.id }) }
    )

    expect(deleteResponse.status).toBe(200)
    expect(await deleteResponse.json()).toEqual({})

    const stored = await database.getScheduledStatus({
      actorId: ACTOR1_ID,
      id: created.id
    })
    expect(stored).toBeNull()

    const getResponse = await GET_ID(
      new NextRequest(
        `https://llun.test/api/v1/scheduled_statuses/${created.id}`,
        { headers: { Origin: 'https://llun.test' } }
      ),
      { params: Promise.resolve({ id: created.id }) }
    )
    expect(getResponse.status).toBe(404)
  })

  it('returns 404 when deleting an unknown scheduled status id', async () => {
    const response = await DELETE(
      new NextRequest(
        'https://llun.test/api/v1/scheduled_statuses/missing-id',
        { method: 'DELETE', headers: { Origin: 'https://llun.test' } }
      ),
      { params: Promise.resolve({ id: 'missing-id' }) }
    )

    expect(response.status).toBe(404)
  })

  it('hydrates media_attachments from the stored media ids', async () => {
    const media = await database.createMedia({
      actorId: ACTOR1_ID,
      original: {
        path: 'medias/scheduled-photo.webp',
        bytes: 2048,
        mimeType: 'image/jpeg',
        metaData: { width: 320, height: 240 },
        fileName: 'scheduled-photo.jpg'
      },
      description: 'Scheduled media description'
    })
    expect(media).not.toBeNull()

    const created = await database.createScheduledStatus({
      actorId: ACTOR1_ID,
      scheduledAt: tenMinutesAhead(),
      params: { ...baseParams('With media'), media_ids: [String(media!.id)] }
    })

    const response = await GET_ID(
      new NextRequest(
        `https://llun.test/api/v1/scheduled_statuses/${created.id}`,
        { headers: { Origin: 'https://llun.test' } }
      ),
      { params: Promise.resolve({ id: created.id }) }
    )

    expect(response.status).toBe(200)
    const scheduled = await response.json()
    expect(scheduled.media_attachments).toHaveLength(1)
    expect(scheduled.media_attachments[0]).toMatchObject({
      type: 'image',
      description: 'Scheduled media description'
    })
  })
})
