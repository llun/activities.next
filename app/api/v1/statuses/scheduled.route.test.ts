import knex, { Knex } from 'knex'
import { NextRequest } from 'next/server'

import { getSQLDatabase } from '@/lib/database/sql'
import { PUBLISH_SCHEDULED_STATUS_JOB_NAME } from '@/lib/jobs/names'
import { SCHEDULED_AT_TOO_SOON_ERROR } from '@/lib/services/mastodon/constants'
import { getQueue } from '@/lib/services/queue'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { getHashFromString } from '@/lib/utils/getHashFromString'

import { POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getSQLDatabase> | null = null
let mockKnex: Knex | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => mockKnex
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

describe('POST /api/v1/statuses', () => {
  const knexInstance = knex({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: { filename: ':memory:' }
  })
  const database = getSQLDatabase(knexInstance)

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
    mockKnex = knexInstance
  })

  afterAll(async () => {
    mockDatabase = null
    mockKnex = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  it('stores a scheduled status instead of publishing when scheduled_at is far enough ahead', async () => {
    const before = await database.getActorStatuses({ actorId: ACTOR1_ID })
    const scheduledAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    const response = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: JSON.stringify({
          status: 'See you in ten minutes',
          scheduled_at: scheduledAt
        }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    const scheduledStatus = await response.json()
    expect(scheduledStatus.scheduled_at).toBe(scheduledAt)
    expect(scheduledStatus.params.text).toBe('See you in ten minutes')
    expect(scheduledStatus.media_attachments).toEqual([])
    // No status was published, but a delayed publish job was queued.
    const after = await database.getActorStatuses({ actorId: ACTOR1_ID })
    expect(after).toHaveLength(before.length)
    expect(getQueue().publish).toHaveBeenCalledTimes(1)
    const publishArgs = (getQueue().publish as jest.Mock).mock.calls[0][0]
    expect(publishArgs).toMatchObject({
      name: PUBLISH_SCHEDULED_STATUS_JOB_NAME,
      data: { scheduledStatusId: scheduledStatus.id }
    })
    expect(publishArgs.delaySeconds).toEqual(expect.any(Number))
    // The dedup id folds in scheduledAt so a later reschedule is not dropped by
    // QStash deduplication of the original schedule.
    expect(publishArgs.id).toBe(
      getHashFromString(`${scheduledStatus.id}-${Date.parse(scheduledAt)}`)
    )

    // Exactly one scheduled row now exists for the actor.
    const stored = await database.getScheduledStatuses({
      actorId: ACTOR1_ID,
      limit: 40
    })
    expect(stored.map((row) => row.id)).toContain(scheduledStatus.id)
  })

  it('rolls back the stored scheduled status and returns 500 when enqueue fails', async () => {
    const before = await database.getScheduledStatuses({
      actorId: ACTOR1_ID,
      limit: 40
    })
    ;(getQueue().publish as jest.Mock).mockRejectedValueOnce(
      new Error('queue unavailable')
    )
    const scheduledAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    const response = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: JSON.stringify({
          status: 'Enqueue will fail',
          scheduled_at: scheduledAt
        }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(500)
    // The orphan row was rolled back: no new scheduled status remains.
    const after = await database.getScheduledStatuses({
      actorId: ACTOR1_ID,
      limit: 40
    })
    expect(after).toHaveLength(before.length)
  })

  it('stores a scheduled status with the actor default privacy when visibility is omitted', async () => {
    await database.updateActor({
      actorId: ACTOR1_ID,
      defaultPrivacy: 'private'
    })
    try {
      const scheduledAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

      const response = await POST(
        new NextRequest('https://llun.test/api/v1/statuses', {
          method: 'POST',
          body: JSON.stringify({
            status: 'Scheduled with default privacy',
            scheduled_at: scheduledAt
          }),
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://llun.test'
          }
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      const scheduledStatus = await response.json()
      expect(scheduledStatus.params.visibility).toBe('private')
    } finally {
      await database.updateActor({
        actorId: ACTOR1_ID,
        defaultPrivacy: 'public'
      })
    }
  })

  it('stores a scheduled reply with the parent visibility when visibility is omitted', async () => {
    // actor1 is a direct recipient of actor2's DM; the actor's own default
    // privacy is public, which the reply must not fall back to.
    const parentId = `${ACTOR2_ID}/statuses/scheduled-reply-dm-parent`
    await database.createNote({
      id: parentId,
      url: parentId,
      actorId: ACTOR2_ID,
      text: 'a direct message to actor1',
      to: [ACTOR1_ID],
      cc: []
    })
    const scheduledAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    const response = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: JSON.stringify({
          status: 'Scheduled reply to a DM',
          in_reply_to_id: parentId,
          scheduled_at: scheduledAt
        }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    const scheduledStatus = await response.json()
    expect(scheduledStatus.params.visibility).toBe('direct')
  })

  it('returns 404 when scheduling a reply to a status the actor cannot read', async () => {
    const parentId = `${ACTOR2_ID}/statuses/scheduled-reply-unreadable-parent`
    await database.createNote({
      id: parentId,
      url: parentId,
      actorId: ACTOR2_ID,
      text: 'a direct message between other actors',
      to: [ACTOR3_ID],
      cc: []
    })
    const before = await database.getScheduledStatuses({
      actorId: ACTOR1_ID,
      limit: 40
    })
    const scheduledAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    const response = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: JSON.stringify({
          status: 'Scheduled reply into a stranger DM',
          visibility: 'direct',
          in_reply_to_id: parentId,
          scheduled_at: scheduledAt
        }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(404)
    const after = await database.getScheduledStatuses({
      actorId: ACTOR1_ID,
      limit: 40
    })
    expect(after).toHaveLength(before.length)
  })

  it('treats a blank scheduled_at as an immediate post', async () => {
    const before = await database.getScheduledStatuses({
      actorId: ACTOR1_ID,
      limit: 40
    })

    const response = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: JSON.stringify({
          status: 'Blank schedule posts now',
          scheduled_at: '   '
        }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    const mastodonStatus = await response.json()
    // A real status was published, not a scheduled one.
    expect(mastodonStatus.id).toBeTruthy()
    expect(mastodonStatus.scheduled_at).toBeUndefined()
    const after = await database.getScheduledStatuses({
      actorId: ACTOR1_ID,
      limit: 40
    })
    expect(after).toHaveLength(before.length)
  })

  it('returns 422 when scheduled_at is less than five minutes ahead', async () => {
    const scheduledAt = new Date(Date.now() + 2 * 60 * 1000).toISOString()

    const response = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: JSON.stringify({
          status: 'Too soon to schedule',
          scheduled_at: scheduledAt
        }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(422)
    const error = await response.json()
    expect(error.error).toBe(SCHEDULED_AT_TOO_SOON_ERROR)
    expect(getQueue().publish).not.toHaveBeenCalled()
  })

  it('stores a scheduled status with a poll when scheduled_at is far enough ahead', async () => {
    const scheduledAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    const response = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: JSON.stringify({
          status: 'Scheduled favourite color?',
          scheduled_at: scheduledAt,
          poll: {
            options: ['Red', 'Green', 'Blue'],
            expires_in: 3600,
            multiple: true
          }
        }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    const scheduledStatus = await response.json()
    expect(scheduledStatus.scheduled_at).toBe(scheduledAt)
    expect(scheduledStatus.params.poll).toMatchObject({
      options: ['Red', 'Green', 'Blue'],
      expires_in: 3600,
      multiple: true
    })
    // No status was published, but a delayed publish job was queued.
    expect(getQueue().publish).toHaveBeenCalledTimes(1)
    expect(getQueue().publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: PUBLISH_SCHEDULED_STATUS_JOB_NAME,
        data: expect.objectContaining({
          scheduledStatusId: scheduledStatus.id
        }),
        delaySeconds: expect.any(Number)
      })
    )

    const stored = await database.getScheduledStatuses({
      actorId: ACTOR1_ID,
      limit: 40
    })
    const storedRow = stored.find((row) => row.id === scheduledStatus.id)
    expect(storedRow).toBeTruthy()
    expect(storedRow?.params.poll?.options).toEqual(['Red', 'Green', 'Blue'])
  })
})
