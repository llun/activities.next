import knex, { Knex } from 'knex'
import { NextRequest } from 'next/server'

import { getSQLDatabase } from '@/lib/database/sql'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { PUBLISH_SCHEDULED_STATUS_JOB_NAME } from '@/lib/jobs/names'
import { hashToken } from '@/lib/services/guards/OAuthGuard'
import { SCHEDULED_AT_TOO_SOON_ERROR } from '@/lib/services/mastodon/constants'
import { getQueue } from '@/lib/services/queue'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { Status } from '@/lib/types/domain/status'
import { getNoteFromStatus } from '@/lib/utils/getNoteFromStatus'
import { urlToId } from '@/lib/utils/urlToId'

import { GET, POST } from './route'

// better-auth stores tokens hashed as SHA-256 base64url; the guard re-hashes the
// presented bearer token to look it up, so seeded tokens must match.

const mockGetServerSession = jest.fn()
jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getSQLDatabase> | null = null
let mockKnex: Knex | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => mockKnex
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
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  it('attaches JSON media_ids to the created status', async () => {
    const media = await database.createMedia({
      actorId: ACTOR1_ID,
      original: {
        path: 'medias/json-status-photo.webp',
        bytes: 2048,
        mimeType: 'image/jpeg',
        metaData: { width: 640, height: 480 },
        fileName: 'json-status-photo.jpg'
      },
      description: 'JSON media description'
    })

    expect(media).not.toBeNull()

    const response = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: JSON.stringify({
          status: 'Status created from JSON with media',
          media_ids: [media!.id]
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
    expect(mastodonStatus.media_attachments).toHaveLength(1)
    expect(mastodonStatus.media_attachments[0]).toMatchObject({
      type: 'image',
      url: 'https://llun.test/api/v1/files/medias/json-status-photo.webp',
      description: 'JSON media description',
      meta: {
        original: {
          width: 640,
          height: 480,
          size: '640x480'
        }
      }
    })

    const attachments = await database.getAttachmentsWithMedia({
      statusId: mastodonStatus.uri
    })
    expect(attachments).toHaveLength(1)
    expect(attachments[0]).toMatchObject({
      mediaId: String(media!.id),
      url: 'https://llun.test/api/v1/files/medias/json-status-photo.webp',
      name: 'JSON media description'
    })

    const status = (await database.getStatus({
      statusId: mastodonStatus.uri,
      withReplies: false
    })) as Status
    const activityPubNote = getNoteFromStatus(status)
    expect(activityPubNote?.attachment).toEqual([
      expect.objectContaining({
        type: 'Document',
        mediaType: 'image/jpeg',
        url: 'https://llun.test/api/v1/files/medias/json-status-photo.webp',
        name: 'JSON media description'
      })
    ])
    expect(getQueue().publish).toHaveBeenCalledTimes(1)
  })

  it('attaches form media_ids[] to the created status', async () => {
    const media = await database.createMedia({
      actorId: ACTOR1_ID,
      original: {
        path: 'medias/form-status-photo.webp',
        bytes: 4096,
        mimeType: 'image/png',
        metaData: { width: 300, height: 200 },
        fileName: 'form-status-photo.png'
      }
    })

    expect(media).not.toBeNull()

    const body = new URLSearchParams()
    body.set('status', 'Status created from form data')
    body.append('media_ids[]', media!.id)

    const response = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: 'https://llun.test'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    const mastodonStatus = await response.json()
    expect(mastodonStatus.media_attachments).toHaveLength(1)
    expect(mastodonStatus.media_attachments[0]).toMatchObject({
      type: 'image',
      url: 'https://llun.test/api/v1/files/medias/form-status-photo.webp',
      description: 'form-status-photo.png'
    })

    const attachments = await database.getAttachmentsWithMedia({
      statusId: mastodonStatus.uri
    })
    expect(attachments).toHaveLength(1)
    expect(attachments[0]).toMatchObject({
      mediaId: String(media!.id),
      name: 'form-status-photo.png'
    })
  })

  it('attaches multipart media_ids[] and ignores duplicates', async () => {
    const firstMedia = await database.createMedia({
      actorId: ACTOR1_ID,
      original: {
        path: 'medias/multipart-status-first.webp',
        bytes: 4096,
        mimeType: 'image/png',
        metaData: { width: 300, height: 200 },
        fileName: 'multipart-status-first.png'
      }
    })
    const secondMedia = await database.createMedia({
      actorId: ACTOR1_ID,
      original: {
        path: 'medias/multipart-status-second.webp',
        bytes: 4096,
        mimeType: 'image/png',
        metaData: { width: 400, height: 300 },
        fileName: 'multipart-status-second.png'
      }
    })

    expect(firstMedia).not.toBeNull()
    expect(secondMedia).not.toBeNull()

    const form = new FormData()
    form.set('status', 'Status created from multipart data')
    form.append('media_ids[]', firstMedia!.id)
    form.append('media_ids[]', firstMedia!.id)
    form.append('media_ids[]', secondMedia!.id)
    const request = new NextRequest('https://llun.test/api/v1/statuses', {
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=test-boundary',
        Origin: 'https://llun.test'
      }
    })
    Object.defineProperty(request, 'formData', {
      value: jest.fn().mockResolvedValue(form)
    })

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    const mastodonStatus = await response.json()
    expect(mastodonStatus.media_attachments).toHaveLength(2)
    expect(mastodonStatus.media_attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: 'https://llun.test/api/v1/files/medias/multipart-status-first.webp'
        }),
        expect.objectContaining({
          url: 'https://llun.test/api/v1/files/medias/multipart-status-second.webp'
        })
      ])
    )

    const attachments = await database.getAttachmentsWithMedia({
      statusId: mastodonStatus.uri
    })
    expect(attachments).toHaveLength(2)
  })

  it('returns 422 when status has neither text nor media', async () => {
    const response = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: JSON.stringify({
          status: '   '
        }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(422)
    expect(getQueue().publish).not.toHaveBeenCalled()
  })

  it('rejects media_ids that do not belong to the authenticated account', async () => {
    const media = await database.createMedia({
      actorId: ACTOR2_ID,
      original: {
        path: 'medias/other-account-photo.webp',
        bytes: 1024,
        mimeType: 'image/jpeg',
        metaData: { width: 100, height: 100 },
        fileName: 'other-account-photo.jpg'
      }
    })

    expect(media).not.toBeNull()

    const response = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: JSON.stringify({
          status: 'This should not attach another account media',
          media_ids: [media!.id]
        }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(422)
  })

  it('rejects more media_ids than the instance advertises', async () => {
    const mediaIds: string[] = []
    for (let index = 0; index < 5; index += 1) {
      const media = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: `medias/too-many-attachments-${index}.webp`,
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 100, height: 100 },
          fileName: `too-many-attachments-${index}.jpg`
        }
      })
      expect(media).not.toBeNull()
      mediaIds.push(media!.id)
    }

    const response = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: JSON.stringify({
          status: 'This should not exceed the advertised attachment limit',
          media_ids: mediaIds
        }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(422)
    expect(getQueue().publish).not.toHaveBeenCalled()
  })

  it('honors sensitive and language on a JSON create', async () => {
    const response = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: JSON.stringify({
          status: 'Marked sensitive without a content warning',
          sensitive: true,
          language: 'th'
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
    // Sensitive is honored even though there is no spoiler_text.
    expect(mastodonStatus.sensitive).toBe(true)
    expect(mastodonStatus.spoiler_text).toBe('')
    expect(mastodonStatus.language).toBe('th')
  })

  it('coerces a form-encoded sensitive=false into a non-sensitive status', async () => {
    const body = new URLSearchParams()
    body.set('status', 'Form sensitive false should not be sensitive')
    body.set('sensitive', 'false')

    const response = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: 'https://llun.test'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    const mastodonStatus = await response.json()
    expect(mastodonStatus.sensitive).toBe(false)
  })

  it('creates a poll from JSON poll params', async () => {
    const response = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: JSON.stringify({
          status: 'Favourite color?',
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
    const mastodonStatus = await response.json()
    expect(mastodonStatus.poll).not.toBeNull()
    expect(mastodonStatus.poll.multiple).toBe(true)
    expect(mastodonStatus.poll.options).toEqual([
      { title: 'Red', votes_count: 0 },
      { title: 'Green', votes_count: 0 },
      { title: 'Blue', votes_count: 0 }
    ])
  })

  it('creates a poll from flattened form poll params', async () => {
    const body = new URLSearchParams()
    body.set('status', 'Tea or coffee?')
    body.append('poll[options][]', 'Tea')
    body.append('poll[options][]', 'Coffee')
    body.set('poll[expires_in]', '600')

    const response = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: 'https://llun.test'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    const mastodonStatus = await response.json()
    expect(mastodonStatus.poll.options).toEqual([
      { title: 'Tea', votes_count: 0 },
      { title: 'Coffee', votes_count: 0 }
    ])
    expect(mastodonStatus.poll.multiple).toBe(false)
  })

  it('rejects a status that carries both media and a poll with 422', async () => {
    const media = await database.createMedia({
      actorId: ACTOR1_ID,
      original: {
        path: 'medias/poll-and-media.webp',
        bytes: 1024,
        mimeType: 'image/jpeg',
        metaData: { width: 100, height: 100 },
        fileName: 'poll-and-media.jpg'
      }
    })
    expect(media).not.toBeNull()

    const response = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: JSON.stringify({
          status: 'Cannot have both',
          media_ids: [media!.id],
          poll: { options: ['a', 'b'], expires_in: 3600 }
        }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(422)
  })

  it('rejects a poll with fewer than two options with 422', async () => {
    const response = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: JSON.stringify({
          status: 'Only one option',
          poll: { options: ['Lonely'], expires_in: 3600 }
        }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(422)
  })

  it('returns the original status for a repeated Idempotency-Key', async () => {
    const idempotencyKey = 'idem-key-abc-123'
    const makeRequest = () =>
      POST(
        new NextRequest('https://llun.test/api/v1/statuses', {
          method: 'POST',
          body: JSON.stringify({ status: 'Idempotent create' }),
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://llun.test',
            'Idempotency-Key': idempotencyKey
          }
        }),
        { params: Promise.resolve({}) }
      )

    const firstResponse = await makeRequest()
    expect(firstResponse.status).toBe(200)
    const firstStatus = await firstResponse.json()

    const secondResponse = await makeRequest()
    expect(secondResponse.status).toBe(200)
    const secondStatus = await secondResponse.json()

    // Same status id is returned, and no duplicate was created.
    expect(secondStatus.id).toBe(firstStatus.id)
    const owned = await database.getActorStatuses({ actorId: ACTOR1_ID })
    const matching = owned.filter((status) => status.id === firstStatus.uri)
    expect(matching).toHaveLength(1)
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
    expect(getQueue().publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: PUBLISH_SCHEDULED_STATUS_JOB_NAME,
        data: { scheduledStatusId: scheduledStatus.id },
        delaySeconds: expect.any(Number)
      })
    )

    // Exactly one scheduled row now exists for the actor.
    const stored = await database.getScheduledStatuses({
      actorId: ACTOR1_ID,
      limit: 40
    })
    expect(stored.map((row) => row.id)).toContain(scheduledStatus.id)
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
        data: { scheduledStatusId: scheduledStatus.id },
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

  it('does not resurrect a deleted status for a reused Idempotency-Key (orphan cleanup)', async () => {
    const idempotencyKey = 'idem-key-orphan-456'
    const makeRequest = () =>
      POST(
        new NextRequest('https://llun.test/api/v1/statuses', {
          method: 'POST',
          body: JSON.stringify({ status: 'Idempotent then deleted' }),
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://llun.test',
            'Idempotency-Key': idempotencyKey
          }
        }),
        { params: Promise.resolve({}) }
      )

    const firstResponse = await makeRequest()
    const firstStatus = await firstResponse.json()

    // Deleting the status must also drop the idempotency key pointing at it.
    await database.deleteStatus({ statusId: firstStatus.uri })
    await expect(
      database.getIdempotentStatusId({
        actorId: ACTOR1_ID,
        key: idempotencyKey
      })
    ).resolves.toBeNull()

    // A retry now creates a fresh status (not a 404/duplicate loop) and re-keys.
    const secondResponse = await makeRequest()
    expect(secondResponse.status).toBe(200)
    const secondStatus = await secondResponse.json()
    expect(secondStatus.id).not.toBe(firstStatus.id)
    await expect(
      database.getIdempotentStatusId({
        actorId: ACTOR1_ID,
        key: idempotencyKey
      })
    ).resolves.toBe(secondStatus.uri)
  })

  it('records the OAuth client as the application on a token-created status', async () => {
    await knexInstance('oauthClient').insert({
      id: 'oauth-client-row-1',
      clientId: 'client-test-app',
      name: 'Test App',
      uri: null,
      redirectUris: JSON.stringify(['https://app.example.com/callback']),
      scopes: JSON.stringify(['write'])
    })
    await knexInstance('oauthAccessToken').insert({
      id: 'oauth-access-token-1',
      token: hashToken('app-write-token'),
      clientId: 'client-test-app',
      referenceId: ACTOR1_ID,
      expiresAt: new Date(Date.now() + 3600000),
      scopes: JSON.stringify(['write'])
    })

    const response = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: JSON.stringify({ status: 'Posted via an app token' }),
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer app-write-token'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    const mastodonStatus = await response.json()
    expect(mastodonStatus.application).toEqual({
      name: 'Test App',
      website: null
    })
  })

  it('records the OAuth client application on a token-created poll, including the client website', async () => {
    await knexInstance('oauthClient').insert({
      id: 'oauth-client-row-2',
      clientId: 'client-poll-app',
      name: 'Poll App',
      uri: 'https://poll.example.com',
      redirectUris: JSON.stringify(['https://poll.example.com/callback']),
      scopes: JSON.stringify(['write'])
    })
    await knexInstance('oauthAccessToken').insert({
      id: 'oauth-access-token-2',
      token: hashToken('poll-write-token'),
      clientId: 'client-poll-app',
      referenceId: ACTOR1_ID,
      expiresAt: new Date(Date.now() + 3600000),
      scopes: JSON.stringify(['write'])
    })

    const response = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: JSON.stringify({
          status: 'Which option do you prefer?',
          poll: { options: ['a', 'b'], expires_in: 3600 }
        }),
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer poll-write-token'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    const mastodonStatus = await response.json()
    expect(mastodonStatus.poll).not.toBeNull()
    expect(mastodonStatus.application).toEqual({
      name: 'Poll App',
      website: 'https://poll.example.com'
    })
  })

  it('leaves application null for a web-session created status', async () => {
    const response = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: JSON.stringify({ status: 'Posted from the web session' }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    const mastodonStatus = await response.json()
    expect(mastodonStatus.application).toBeNull()
  })
})

describe('GET /api/v1/statuses', () => {
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

  it('returns readable statuses in request order and filters out missing ids', async () => {
    const firstId = `${ACTOR1_ID}/statuses/post-1`
    const secondId = `${ACTOR1_ID}/statuses/post-2`

    const req = new NextRequest(
      `https://llun.test/api/v1/statuses?id[]=${urlToId(firstId)}&id[]=${urlToId(secondId)}&id[]=missing`
    )
    const response = await GET(req, { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.map((s: { id: string }) => s.id)).toEqual([
      urlToId(firstId),
      urlToId(secondId)
    ])
  })

  it('excludes a direct status by another actor that the authenticated actor cannot read', async () => {
    const privateStatusId = `${ACTOR2_ID}/statuses/direct-to-actor3-only`
    await database.createNote({
      id: privateStatusId,
      url: privateStatusId,
      actorId: ACTOR2_ID,
      to: [ACTOR3_ID],
      cc: [],
      text: 'Direct message to actor3 only'
    })

    const req = new NextRequest(
      `https://llun.test/api/v1/statuses?id[]=${urlToId(privateStatusId)}`
    )
    const response = await GET(req, { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.map((s: { id: string }) => s.id)).not.toContain(
      urlToId(privateStatusId)
    )
  })
})
