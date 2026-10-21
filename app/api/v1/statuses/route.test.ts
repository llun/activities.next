import { NextRequest } from 'next/server'

import { GET as getStatusById } from '@/app/api/v1/statuses/[id]/route'
import { IDEMPOTENCY_PENDING_STALE_MS } from '@/lib/database/domains/idempotency/types'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { deleteServerSetting } from '@/lib/database/testing/fixtures'
import type { Database } from '@/lib/database/types'
import { CounterKey } from '@/lib/database/utils/counter'
import { SEND_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { hashToken } from '@/lib/services/guards/OAuthGuard'
import {
  MAX_FEDERATION_MEDIA_ATTACHMENTS,
  MAX_STORED_MEDIA_ATTACHMENTS
} from '@/lib/services/mastodon/constants'
import { getQueue } from '@/lib/services/queue'
import { invalidateServerSettingsCache } from '@/lib/services/serverSettings'
import {
  CREATED_AT_INVALID_ERROR,
  CREATED_AT_WITH_SCHEDULED_AT_ERROR
} from '@/lib/services/statuses/backdatedCreatedAt'
import { seedDatabase } from '@/lib/stub/database'
import { statusPublicId } from '@/lib/stub/publicIds'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { createDeferred } from '@/lib/testing/deferred'
import {
  Status,
  StatusNote,
  StatusPoll,
  StatusType
} from '@/lib/types/domain/status'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { getNoteFromStatus } from '@/lib/utils/getNoteFromStatus'
import { generatePublicId, getPublicIdTimestamp } from '@/lib/utils/publicId'
import { urlToId } from '@/lib/utils/urlToId'

import { GET, MAX_BATCH_STATUSES, POST } from './route'

// better-auth stores tokens hashed as SHA-256 base64url; the guard re-hashes the
// presented bearer token to look it up, so seeded tokens must match.

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

const flushMicrotasks = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

describe('POST /api/v1/statuses', () => {
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

  describe('in_reply_to_id resolution', () => {
    // Regression coverage for the pre-existing bug: in_reply_to_id was never
    // decoded, so a colon-form (or publicId-form) reply target silently
    // created a non-reply because createNoteFromUserInput does an exact
    // `where('id', …)` lookup with no decoding of its own.
    it.each([
      {
        description: 'colon form',
        toParam: (parentId: string) => urlToId(parentId)
      },
      {
        description: 'publicId form',
        toParam: async (parentId: string) => {
          const parent = await database.getStatus({ statusId: parentId })
          if (!parent?.publicId) {
            throw new Error('seeded parent status is missing a publicId')
          }
          return parent.publicId
        }
      },
      {
        description: 'raw URI form',
        toParam: (parentId: string) => parentId
      }
    ])(
      'creates a reply when in_reply_to_id is given in $description',
      async ({ toParam }) => {
        const parent = await database.createNote({
          id: `${ACTOR1_ID}/statuses/route-reply-parent-${generatePublicId()}`,
          url: `${ACTOR1_ID}/statuses/route-reply-parent-${generatePublicId()}`,
          actorId: ACTOR1_ID,
          text: 'parent post',
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: []
        })
        const inReplyToId = await toParam(parent.id)

        const response = await POST(
          new NextRequest('https://llun.test/api/v1/statuses', {
            method: 'POST',
            body: JSON.stringify({
              status: 'a reply',
              in_reply_to_id: inReplyToId
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
        const created = await database.getStatus({
          statusId: mastodonStatus.uri,
          withReplies: false
        })
        expect(created?.type).toBe(StatusType.enum.Note)
        if (!created || created.type !== StatusType.enum.Note) {
          throw new Error('Expected note status')
        }
        expect(created.reply).toBe(parent.id)
      }
    )
  })

  it('creates a status via POST, emits its publicId, and reads back identically via the legacy colon-form id', async () => {
    const response = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: JSON.stringify({
          status: 'a fresh status for the publicId round-trip'
        }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    const created = await response.json()

    const storedStatus = (await database.getStatus({
      statusId: created.uri,
      withReplies: false
    })) as Status
    if (!storedStatus.publicId) {
      throw new Error('newly created status is missing a publicId')
    }
    // PR 2 flips emission: the POST response id is the minted publicId, while
    // `uri` keeps carrying the ActivityPub URI.
    expect(created.id).toBe(storedStatus.publicId)

    const colonFormId = urlToId(created.uri)
    const [colonFormResponse, publicIdResponse] = await Promise.all([
      getStatusById(
        new NextRequest(`https://llun.test/api/v1/statuses/${colonFormId}`),
        { params: Promise.resolve({ id: colonFormId }) }
      ),
      getStatusById(
        new NextRequest(`https://llun.test/api/v1/statuses/${created.id}`),
        { params: Promise.resolve({ id: created.id }) }
      )
    ])

    expect(colonFormResponse.status).toBe(200)
    expect(publicIdResponse.status).toBe(200)
    expect(await publicIdResponse.json()).toEqual(
      await colonFormResponse.json()
    )
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
      description: ''
    })

    const attachments = await database.getAttachmentsWithMedia({
      statusId: mastodonStatus.uri
    })
    expect(attachments).toHaveLength(1)
    expect(attachments[0]).toMatchObject({
      mediaId: String(media!.id),
      name: ''
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
      value: vi.fn().mockResolvedValue(form)
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

  it('rejects more media_ids than the stored ceiling advertises', async () => {
    const mediaIds = Array.from(
      { length: MAX_STORED_MEDIA_ATTACHMENTS + 1 },
      (_, index) => `too-many-attachments-${index}`
    )

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

  it('accepts more media_ids than the federation cap and stores them all', async () => {
    const storedCount = MAX_FEDERATION_MEDIA_ATTACHMENTS + 1
    const mediaIds: string[] = []
    for (let index = 0; index < storedCount; index += 1) {
      const media = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: `medias/many-attachments-${index}.webp`,
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 100, height: 100 },
          fileName: `many-attachments-${index}.jpg`
        }
      })
      expect(media).not.toBeNull()
      mediaIds.push(media!.id)
    }

    const response = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: JSON.stringify({
          status: 'A ride with more photos than Mastodon renders',
          media_ids: mediaIds
        }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.media_attachments).toHaveLength(storedCount)
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

  it('rejects a status over the configured character limit with 422', async () => {
    await database.setServerSettings([
      { key: 'posts.maxCharacters', value: 10 }
    ])
    invalidateServerSettingsCache(database)
    try {
      const response = await POST(
        new NextRequest('https://llun.test/api/v1/statuses', {
          method: 'POST',
          body: JSON.stringify({ status: 'x'.repeat(11) }),
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://llun.test'
          }
        }),
        { params: Promise.resolve({}) }
      )
      expect(response.status).toBe(422)
    } finally {
      await deleteServerSetting(db, { key: 'posts.maxCharacters' })
      invalidateServerSettingsCache(database)
    }
  })

  it('accepts a longer status when the character limit is raised', async () => {
    await database.setServerSettings([
      {
        key: 'posts.maxCharacters',
        value: 5000
      }
    ])
    invalidateServerSettingsCache(database)
    try {
      const response = await POST(
        new NextRequest('https://llun.test/api/v1/statuses', {
          method: 'POST',
          body: JSON.stringify({ status: 'x'.repeat(1000) }),
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://llun.test'
          }
        }),
        { params: Promise.resolve({}) }
      )
      expect(response.status).toBe(200)
    } finally {
      await deleteServerSetting(db, { key: 'posts.maxCharacters' })
      invalidateServerSettingsCache(database)
    }
  })

  it('rejects a poll with more options than the configured limit with 422', async () => {
    await database.setServerSettings([{ key: 'polls.maxOptions', value: 2 }])
    invalidateServerSettingsCache(database)
    try {
      const response = await POST(
        new NextRequest('https://llun.test/api/v1/statuses', {
          method: 'POST',
          body: JSON.stringify({
            status: 'Pick one',
            poll: { options: ['a', 'b', 'c'], expires_in: 3600 }
          }),
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://llun.test'
          }
        }),
        { params: Promise.resolve({}) }
      )
      expect(response.status).toBe(422)
    } finally {
      await deleteServerSetting(db, { key: 'polls.maxOptions' })
      invalidateServerSettingsCache(database)
    }
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

  it('persists poll hide_totals on a JSON poll create', async () => {
    const response = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: JSON.stringify({
          status: 'Secret tally?',
          poll: { options: ['Yes', 'No'], expires_in: 3600, hide_totals: true }
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
    const status = (await database.getStatus({
      statusId: mastodonStatus.uri,
      withReplies: false
    })) as StatusPoll
    expect(status.hideTotals).toBe(true)
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

  it('does not resurrect a deleted status for a reused Idempotency-Key and responds with 410', async () => {
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
    expect(firstResponse.status).toBe(200)
    const firstStatus = await firstResponse.json()

    // Deleting the status keeps its idempotency key so stale retries cannot
    // resurrect the deleted post.
    await database.deleteStatus({ statusId: firstStatus.uri })
    await expect(
      database.getIdempotentStatusId({
        actorId: ACTOR1_ID,
        key: idempotencyKey
      })
    ).resolves.toBe(firstStatus.uri)

    const secondResponse = await makeRequest()
    expect(secondResponse.status).toBe(410)
    await expect(secondResponse.json()).resolves.toEqual({
      error: expect.stringContaining('deleted')
    })
    await expect(
      database.getStatus({ statusId: firstStatus.uri })
    ).resolves.toBeNull()
  })

  it('rejects a reused Idempotency-Key with different request content with 422', async () => {
    const idempotencyKey = 'idem-key-conflict-789'
    const firstResponse = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: JSON.stringify({
          status: 'Original body',
          visibility: 'public'
        }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test',
          'Idempotency-Key': idempotencyKey
        }
      }),
      { params: Promise.resolve({}) }
    )
    expect(firstResponse.status).toBe(200)

    const conflictResponse = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: JSON.stringify({
          status: 'Different body',
          visibility: 'public'
        }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test',
          'Idempotency-Key': idempotencyKey
        }
      }),
      { params: Promise.resolve({}) }
    )
    expect(conflictResponse.status).toBe(422)
    await expect(conflictResponse.json()).resolves.toEqual({
      error: expect.stringContaining('Idempotency-Key')
    })
  })

  it('creates and federates only one status under concurrent duplicate Idempotency-Key requests', async () => {
    const idempotencyKey = 'idem-key-concurrent-race'
    const publishMock = vi.mocked(getQueue().publish)
    publishMock.mockClear()

    const makeConcurrentRequest = () =>
      POST(
        new NextRequest('https://llun.test/api/v1/statuses', {
          method: 'POST',
          body: JSON.stringify({ status: 'Concurrent idempotent post' }),
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://llun.test',
            'Idempotency-Key': idempotencyKey
          }
        }),
        { params: Promise.resolve({}) }
      )

    const responses = await Promise.all([
      makeConcurrentRequest(),
      makeConcurrentRequest(),
      makeConcurrentRequest()
    ])

    for (const response of responses) {
      expect(response.status).toBe(200)
    }
    const payloads = await Promise.all(responses.map((r) => r.json()))
    expect(payloads[1].id).toBe(payloads[0].id)
    expect(payloads[2].id).toBe(payloads[0].id)
    expect(payloads[1].uri).toBe(payloads[0].uri)
    expect(payloads[2].uri).toBe(payloads[0].uri)

    const owned = await database.getActorStatuses({ actorId: ACTOR1_ID })
    const matching = owned.filter(
      (status) =>
        status.type === StatusType.enum.Note &&
        status.text === 'Concurrent idempotent post'
    )
    expect(matching).toHaveLength(1)
    const sendNotePublishes = publishMock.mock.calls.filter(
      ([message]) => message.name === SEND_NOTE_JOB_NAME
    )
    expect(sendNotePublishes).toHaveLength(1)
  })

  const postStatus = (body: Record<string, unknown>, idempotencyKey?: string) =>
    POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test',
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
        }
      }),
      { params: Promise.resolve({}) }
    )

  const statusesWithText = async (text: string) =>
    (await database.getActorStatuses({ actorId: ACTOR1_ID })).filter(
      (status) =>
        status.type !== StatusType.enum.Announce && status.text.includes(text)
    )

  it('rejects an Idempotency-Key longer than 255 characters with 422 before creating anything', async () => {
    const response = await postStatus(
      { status: 'Status with an over-long key' },
      'k'.repeat(256)
    )

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: expect.stringContaining('Idempotency-Key')
    })
    await expect(
      statusesWithText('Status with an over-long key')
    ).resolves.toHaveLength(0)
  })

  it('accepts an Idempotency-Key of exactly 255 characters', async () => {
    const response = await postStatus(
      { status: 'Status with a 255-character key' },
      'k'.repeat(255)
    )
    expect(response.status).toBe(200)
  })

  const createTestMedia = (name: string) =>
    database.createMedia({
      actorId: ACTOR1_ID,
      original: {
        path: `medias/${name}.webp`,
        bytes: 1024,
        mimeType: 'image/jpeg',
        metaData: { width: 10, height: 10 },
        fileName: `${name}.jpg`
      }
    })

  const rowsForStatus = (
    table: 'tags' | 'attachments' | 'timelines',
    statusId: string
  ) =>
    db
      .selectFrom(table)
      .select('statusId')
      .where('statusId', '=', statusId)
      .execute()

  const keyState = async (key: string) =>
    (await database.getIdempotencyKey({ actorId: ACTOR1_ID, key }))?.state

  it('keeps the post and responds 503 when the federation publish fails, and a retry with the key sends it', async () => {
    const idempotencyKey = 'idem-key-publish-fails'
    const text = 'Saved then sent #resent'
    const media = await createTestMedia('kept-photo')
    const publishMock = vi.mocked(getQueue().publish)
    publishMock.mockRejectedValueOnce(new Error('Queue unavailable'))

    const failed = await postStatus(
      { status: text, media_ids: [media!.id] },
      idempotencyKey
    )

    expect(failed.status).toBe(503)
    await expect(failed.json()).resolves.toEqual({
      error: expect.stringContaining('Idempotency-Key')
    })
    const firstJob = publishMock.mock.calls[0][0]
    const statusId = String((firstJob.data as { statusId: string }).statusId)
    expect(firstJob).toMatchObject({
      id: getHashFromString(statusId),
      name: SEND_NOTE_JOB_NAME
    })
    await expect(statusesWithText(text)).resolves.toHaveLength(1)
    await expect(keyState(idempotencyKey)).resolves.toBe('publish_failed')
    await expect(rowsForStatus('attachments', statusId)).resolves.toHaveLength(
      1
    )

    publishMock.mockClear()
    const retried = await postStatus(
      { status: text, media_ids: [media!.id] },
      idempotencyKey
    )

    expect(retried.status).toBe(200)
    const sent = await retried.json()
    expect(sent.uri).toBe(statusId)
    expect(sent.media_attachments).toHaveLength(1)
    expect(publishMock).toHaveBeenCalledTimes(1)
    expect(publishMock.mock.calls[0][0]).toEqual(firstJob)
    await expect(keyState(idempotencyKey)).resolves.toBe('complete')
    await expect(statusesWithText(text)).resolves.toHaveLength(1)
  })

  it('keeps a keyless post and responds 503 when the federation publish fails', async () => {
    const text = 'Keyless saved then queue fails'
    vi.mocked(getQueue().publish).mockRejectedValueOnce(
      new Error('Queue unavailable')
    )

    const response = await postStatus({ status: text })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Your post was saved but could not be sent'
    })
    await expect(statusesWithText(text)).resolves.toHaveLength(1)
  })

  it('rejects a fitness file that another status already holds with 422 and creates nothing', async () => {
    const fitnessFile = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      fileName: 'taken.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 4096,
      path: 'fitness/taken.fit'
    })
    const first = await postStatus({
      status: 'Holds the file',
      fitness_file_id: fitnessFile!.id
    })
    expect(first.status).toBe(200)

    const second = await postStatus({
      status: 'Wants the same file',
      fitness_file_id: fitnessFile!.id
    })

    expect(second.status).toBe(422)
    await expect(statusesWithText('Wants the same file')).resolves.toHaveLength(
      0
    )
  })

  it("reports the replaying actor's favourite on a repeated Idempotency-Key", async () => {
    const idempotencyKey = 'idem-key-viewer-state'
    const created = await (
      await postStatus({ status: 'Favourite me' }, idempotencyKey)
    ).json()
    expect(created.favourited).toBe(false)
    await database.createLike({ actorId: ACTOR1_ID, statusId: created.uri })

    const replayed = await postStatus(
      { status: 'Favourite me' },
      idempotencyKey
    )

    expect(replayed.status).toBe(200)
    await expect(replayed.json()).resolves.toMatchObject({
      id: created.id,
      favourited: true
    })
  })

  // Ages a key past IDEMPOTENCY_PENDING_STALE_MS, as if its request stopped.
  const ageKey = (key: string) => {
    const past = new Date(Date.now() - IDEMPOTENCY_PENDING_STALE_MS)
    return db
      .updateTable('idempotency_keys')
      .set({ createdAt: past, stateChangedAt: past })
      .where('actorId', '=', ACTOR1_ID)
      .where('key', '=', key)
      .execute()
  }

  it('responds 503 and leaves the key pending when the publish claim throws, so a retry sends the post once it is stale', async () => {
    const idempotencyKey = 'idem-key-claim-throws'
    const text = 'Claim failed then sent'
    const publishMock = vi.mocked(getQueue().publish)
    const claimSpy = vi
      .spyOn(database, 'claimIdempotencyKeyPublish')
      .mockRejectedValueOnce(new Error('Database unavailable'))
    try {
      const failed = await postStatus({ status: text }, idempotencyKey)
      expect(failed.status).toBe(503)
    } finally {
      claimSpy.mockRestore()
    }

    expect(publishMock).not.toHaveBeenCalled()
    await expect(keyState(idempotencyKey)).resolves.toBe('pending')
    await expect(statusesWithText(text)).resolves.toHaveLength(1)

    await ageKey(idempotencyKey)
    const retried = await postStatus({ status: text }, idempotencyKey)

    expect(retried.status).toBe(200)
    expect(publishMock).toHaveBeenCalledTimes(1)
    await expect(keyState(idempotencyKey)).resolves.toBe('complete')
  })

  it.each([
    {
      outcome: 'accepted',
      queueError: null,
      firstStatus: 200
    },
    {
      outcome: 'refused',
      queueError: new Error('Queue unavailable'),
      firstStatus: 503
    }
  ])(
    'leaves the key publishing when its state write fails after the queue $outcome the job, and a stale retry queues the same job once',
    async ({ outcome, queueError, firstStatus }) => {
      const idempotencyKey = `idem-key-state-write-fails-${outcome}`
      const text = `State write failed after the queue ${outcome}`
      const publishMock = vi.mocked(getQueue().publish)
      if (queueError) publishMock.mockRejectedValueOnce(queueError)
      const stateSpy = vi
        .spyOn(database, 'setIdempotencyKeyState')
        .mockRejectedValueOnce(new Error('Database unavailable'))
      try {
        const first = await postStatus({ status: text }, idempotencyKey)
        expect(first.status).toBe(firstStatus)
      } finally {
        stateSpy.mockRestore()
      }
      expect(publishMock).toHaveBeenCalledTimes(1)
      const job = publishMock.mock.calls[0][0]
      await expect(keyState(idempotencyKey)).resolves.toBe('publishing')

      // A fresh 'publishing' key may still be waiting on the queue.
      const fresh = await postStatus({ status: text }, idempotencyKey)
      expect(fresh.status).toBe(409)
      expect(publishMock).toHaveBeenCalledTimes(1)

      await ageKey(idempotencyKey)
      const retried = await postStatus({ status: text }, idempotencyKey)
      expect(retried.status).toBe(200)
      expect(publishMock).toHaveBeenCalledTimes(2)
      expect(publishMock.mock.calls[1][0]).toEqual(job)
      await expect(keyState(idempotencyKey)).resolves.toBe('complete')

      const again = await postStatus({ status: text }, idempotencyKey)
      expect(again.status).toBe(200)
      expect(publishMock).toHaveBeenCalledTimes(2)
      await expect(statusesWithText(text)).resolves.toHaveLength(1)
    }
  )

  it('discards the status and its key without publishing when a step before the publish fails, so a retry with the key creates it', async () => {
    const idempotencyKey = 'idem-key-attachment-fails'
    const text = 'Discarded then retried #retried'
    const media = await createTestMedia('discarded-photo')
    const attachmentSpy = vi
      .spyOn(database, 'createAttachment')
      .mockRejectedValueOnce(new Error('Database hiccup'))
    let discardedId: string
    try {
      const failed = await postStatus(
        { status: text, media_ids: [media!.id] },
        idempotencyKey
      )
      expect(failed.status).toBe(400)
      discardedId = attachmentSpy.mock.calls[0][0].statusId
    } finally {
      attachmentSpy.mockRestore()
    }

    expect(vi.mocked(getQueue().publish)).not.toHaveBeenCalled()
    await expect(statusesWithText(text)).resolves.toHaveLength(0)
    await expect(
      database.getIdempotencyKey({ actorId: ACTOR1_ID, key: idempotencyKey })
    ).resolves.toBeNull()
    for (const table of ['tags', 'attachments', 'timelines'] as const) {
      await expect(rowsForStatus(table, discardedId)).resolves.toEqual([])
    }

    const retried = await postStatus(
      { status: text, media_ids: [media!.id] },
      idempotencyKey
    )
    expect(retried.status).toBe(200)
    const created = await retried.json()
    expect(created.media_attachments).toHaveLength(1)
    expect(created.tags).toEqual([expect.objectContaining({ name: 'retried' })])
    await expect(statusesWithText(text)).resolves.toHaveLength(1)
  })

  it.each([
    { description: 'status', body: { status: 'Created but not loadable' } },
    {
      description: 'poll',
      body: {
        status: 'Created poll not loadable',
        poll: { options: ['Yes', 'No'], expires_in: 3600 }
      }
    }
  ])(
    'discards the $description without publishing when it cannot be loaded after its create',
    async ({ description, body }) => {
      const idempotencyKey = `idem-key-hydrate-null-${description}`
      const discardSpy = vi.spyOn(database, 'discardUnpublishedStatus')
      const getStatusSpy = vi
        .spyOn(database, 'getStatus')
        .mockResolvedValue(null)
      try {
        const failed = await postStatus(body, idempotencyKey)
        expect(failed.status).toBe(400)
        expect(discardSpy).toHaveBeenCalled()
      } finally {
        getStatusSpy.mockRestore()
        discardSpy.mockRestore()
      }

      expect(vi.mocked(getQueue().publish)).not.toHaveBeenCalled()
      await expect(statusesWithText(body.status)).resolves.toHaveLength(0)
      await expect(
        database.getIdempotencyKey({ actorId: ACTOR1_ID, key: idempotencyKey })
      ).resolves.toBeNull()
    }
  )

  it('discards the status without publishing when its emoji tags cannot be saved', async () => {
    const text = 'Emoji tags fail :blobcat:'
    const discardSpy = vi.spyOn(database, 'discardUnpublishedStatus')
    const emojiSpy = vi
      .spyOn(database, 'getCustomEmojis')
      .mockRejectedValueOnce(new Error('Database hiccup'))
    try {
      const failed = await postStatus({ status: text }, 'idem-key-emoji-fails')
      expect(failed.status).toBe(400)
      expect(discardSpy).toHaveBeenCalled()
    } finally {
      emojiSpy.mockRestore()
      discardSpy.mockRestore()
    }

    expect(vi.mocked(getQueue().publish)).not.toHaveBeenCalled()
    await expect(statusesWithText(text)).resolves.toHaveLength(0)
  })

  it('discards the poll without publishing when its emoji tags cannot be saved', async () => {
    const text = 'Poll emoji tags fail :blobcat:'
    const idempotencyKey = 'idem-key-poll-emoji-fails'
    const discardSpy = vi.spyOn(database, 'discardUnpublishedStatus')
    const emojiSpy = vi
      .spyOn(database, 'getCustomEmojis')
      .mockRejectedValueOnce(new Error('Database hiccup'))
    try {
      const failed = await postStatus(
        { status: text, poll: { options: ['Yes', 'No'], expires_in: 3600 } },
        idempotencyKey
      )
      expect(failed.status).toBe(400)
      expect(discardSpy).toHaveBeenCalled()
    } finally {
      emojiSpy.mockRestore()
      discardSpy.mockRestore()
    }

    await expect(statusesWithText(text)).resolves.toHaveLength(0)
    await expect(
      database.getIdempotencyKey({ actorId: ACTOR1_ID, key: idempotencyKey })
    ).resolves.toBeNull()
  })

  it('waits for every sibling insert to settle before discarding, so none lands after the discard', async () => {
    const text = 'Sibling inserts settle first'
    const [first, second] = await Promise.all([
      createTestMedia('sibling-first'),
      createTestMedia('sibling-second')
    ])
    const createAttachment = database.createAttachment.bind(database)
    const reached = createDeferred<void>()
    const gate = createDeferred<void>()
    const attachmentSpy = vi
      .spyOn(database, 'createAttachment')
      .mockImplementationOnce(async () => {
        reached.resolve()
        throw new Error('Database hiccup')
      })
      .mockImplementationOnce(async (params) => {
        await gate.promise
        return createAttachment(params)
      })
    const discardSpy = vi.spyOn(database, 'discardUnpublishedStatus')
    try {
      const pending = postStatus(
        { status: text, media_ids: [first!.id, second!.id] },
        'idem-key-sibling-settle'
      )
      await reached.promise
      await flushMicrotasks()
      expect(discardSpy).not.toHaveBeenCalled()

      gate.resolve()
      const failed = await pending
      expect(failed.status).toBe(400)
      expect(discardSpy).toHaveBeenCalled()
      const statusId = attachmentSpy.mock.calls[0][0].statusId
      await expect(rowsForStatus('attachments', statusId)).resolves.toEqual([])
    } finally {
      attachmentSpy.mockRestore()
      discardSpy.mockRestore()
    }
  })

  it('leaves the hashtag counter alone when it discards a post whose hashtags were never counted', async () => {
    const counterId = CounterKey.totalHashtag('neveruncounted')
    const counterValue = async () =>
      (
        await db
          .selectFrom('counters')
          .select('value')
          .where('id', '=', counterId)
          .executeTakeFirst()
      )?.value
    const counted = await postStatus({ status: 'Counted #neveruncounted' })
    expect(counted.status).toBe(200)
    await expect(counterValue()).resolves.toBe(1)

    const media = await createTestMedia('uncounted-photo')
    const attachmentSpy = vi
      .spyOn(database, 'createAttachment')
      .mockRejectedValueOnce(new Error('Database hiccup'))
    try {
      const failed = await postStatus({
        status: 'Discarded #neveruncounted',
        media_ids: [media!.id]
      })
      expect(failed.status).toBe(400)
    } finally {
      attachmentSpy.mockRestore()
    }

    await expect(counterValue()).resolves.toBe(1)
  })

  it('counts hashtags before the publish, so a request that dies in an inline fan-out leaves them counted', async () => {
    const counterId = CounterKey.totalHashtag('countedfirst')
    const counterValue = async () =>
      (
        await db
          .selectFrom('counters')
          .select('value')
          .where('id', '=', counterId)
          .executeTakeFirst()
      )?.value
    let valueAtPublish: number | undefined
    vi.mocked(getQueue().publish).mockImplementationOnce(async () => {
      valueAtPublish = await counterValue()
    })

    const created = await postStatus({ status: 'Counted first #countedfirst' })

    expect(created.status).toBe(200)
    expect(valueAtPublish).toBe(1)
  })

  it('responds 409 while another process may still hold a pending key, and sends the post once the key is stale', async () => {
    const idempotencyKey = 'idem-key-pending-elsewhere'
    const body = { status: 'Pending elsewhere' }
    const created = await postStatus(body, idempotencyKey)
    expect(created.status).toBe(200)
    const { uri } = await created.json()
    await db
      .updateTable('idempotency_keys')
      .set({ state: 'pending' })
      .where('actorId', '=', ACTOR1_ID)
      .where('key', '=', idempotencyKey)
      .execute()
    const publishMock = vi.mocked(getQueue().publish)
    publishMock.mockClear()

    const inProgress = await postStatus(body, idempotencyKey)
    expect(inProgress.status).toBe(409)
    await expect(inProgress.json()).resolves.toEqual({
      error: expect.stringContaining('still being processed')
    })
    expect(publishMock).not.toHaveBeenCalled()

    await db
      .updateTable('idempotency_keys')
      .set({ createdAt: new Date(Date.now() - IDEMPOTENCY_PENDING_STALE_MS) })
      .where('actorId', '=', ACTOR1_ID)
      .where('key', '=', idempotencyKey)
      .execute()
    const stale = await postStatus(body, idempotencyKey)
    expect(stale.status).toBe(200)
    await expect(stale.json()).resolves.toMatchObject({ uri })
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: getHashFromString(uri),
        name: SEND_NOTE_JOB_NAME
      })
    )
    await expect(keyState(idempotencyKey)).resolves.toBe('complete')
    await expect(statusesWithText('Pending elsewhere')).resolves.toHaveLength(1)
  })

  it('returns the winner’s status to a create that lost the key claim to it', async () => {
    const idempotencyKey = 'idem-key-claim-loser'
    const body = { status: 'Claim winner' }
    const winner = await postStatus(body, idempotencyKey)
    expect(winner.status).toBe(200)
    const { id } = await winner.json()
    // Both pre-checks miss the key, as for a request that read it before the
    // winner committed, so this create reaches the claim and loses it.
    const keySpy = vi
      .spyOn(database, 'getIdempotencyKey')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    try {
      const loser = await postStatus(body, idempotencyKey)
      expect(loser.status).toBe(200)
      await expect(loser.json()).resolves.toMatchObject({ id })
    } finally {
      keySpy.mockRestore()
    }
    await expect(statusesWithText('Claim winner')).resolves.toHaveLength(1)
  })

  it('fails a create that lost the key claim to one that was then discarded, so the client retries', async () => {
    const idempotencyKey = 'idem-key-claim-loser-discarded'
    const body = { status: 'Claim winner discarded' }
    const winner = await postStatus(body, idempotencyKey)
    expect(winner.status).toBe(200)
    const createNoteWithResult = database.createNoteWithResult.bind(database)
    const keySpy = vi
      .spyOn(database, 'getIdempotencyKey')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    // The winner is discarded between the lost claim and the loser's read.
    const createSpy = vi
      .spyOn(database, 'createNoteWithResult')
      .mockImplementationOnce(async (params) => {
        const result = await createNoteWithResult(params)
        // A create is discarded only while its key is still 'pending'.
        await db
          .updateTable('idempotency_keys')
          .set({ state: 'pending' })
          .where('actorId', '=', ACTOR1_ID)
          .where('key', '=', idempotencyKey)
          .execute()
        await database.discardUnpublishedStatus({
          actorId: ACTOR1_ID,
          statusId: result.status.id,
          idempotencyKey
        })
        return result
      })
    try {
      const loser = await postStatus(body, idempotencyKey)
      expect(loser.status).toBe(400)
    } finally {
      keySpy.mockRestore()
      createSpy.mockRestore()
    }
    await expect(
      statusesWithText('Claim winner discarded')
    ).resolves.toHaveLength(0)
  })

  it('still returns the status when a best-effort step fails', async () => {
    const indexSpy = vi
      .spyOn(database, 'indexHashtagSearchDocuments')
      .mockRejectedValueOnce(new Error('Search unavailable'))
    try {
      const response = await postStatus(
        { status: 'Survives a search outage #resilient' },
        'idem-key-best-effort'
      )

      expect(response.status).toBe(200)
      const created = await response.json()
      expect(indexSpy).toHaveBeenCalled()
      expect(created.tags).toEqual([
        expect.objectContaining({ name: 'resilient' })
      ])
      expect(vi.mocked(getQueue().publish)).toHaveBeenCalledWith(
        expect.objectContaining({
          name: SEND_NOTE_JOB_NAME,
          data: expect.objectContaining({ statusId: created.uri })
        })
      )
    } finally {
      indexSpy.mockRestore()
    }
  })

  it('discards a poll and its key when a completion step fails, so a retry with the key creates it', async () => {
    const idempotencyKey = 'idem-key-poll-fails'
    const body = {
      status: 'Discarded poll',
      poll: { options: ['Yes', 'No'], expires_in: 3600 }
    }
    const getStatusSpy = vi
      .spyOn(database, 'getStatus')
      .mockRejectedValueOnce(new Error('Database hiccup'))
    try {
      const failed = await postStatus(body, idempotencyKey)
      expect(failed.status).toBe(400)
    } finally {
      getStatusSpy.mockRestore()
    }
    await expect(statusesWithText('Discarded poll')).resolves.toHaveLength(0)
    await expect(
      database.getIdempotencyKey({ actorId: ACTOR1_ID, key: idempotencyKey })
    ).resolves.toBeNull()

    const retried = await postStatus(body, idempotencyKey)
    expect(retried.status).toBe(200)
    await expect(statusesWithText('Discarded poll')).resolves.toHaveLength(1)
  })

  it('returns the original poll for a repeated Idempotency-Key and 422 for different poll content', async () => {
    const idempotencyKey = 'idem-key-poll-repeat'
    const body = {
      status: 'Idempotent poll',
      poll: { options: ['Red', 'Blue'], expires_in: 3600 }
    }

    const first = await postStatus(body, idempotencyKey)
    expect(first.status).toBe(200)
    const firstPoll = await first.json()
    const second = await postStatus(body, idempotencyKey)
    expect(second.status).toBe(200)
    await expect(second.json()).resolves.toMatchObject({ id: firstPoll.id })
    await expect(statusesWithText('Idempotent poll')).resolves.toHaveLength(1)

    const conflict = await postStatus(
      { ...body, poll: { ...body.poll, options: ['Red', 'Green'] } },
      idempotencyKey
    )
    expect(conflict.status).toBe(422)
    await expect(conflict.json()).resolves.toEqual({
      error: expect.stringContaining('Idempotency-Key')
    })
  })

  const NOTE_HASH_BASE = { status: 'Hashed note', visibility: 'public' }
  const POLL_HASH_BASE = {
    status: 'Hashed poll',
    poll: { options: ['One', 'Two'], expires_in: 3600 }
  }
  it.each([
    {
      description: 'status',
      base: NOTE_HASH_BASE,
      change: { status: 'Other' }
    },
    {
      description: 'media_ids',
      base: NOTE_HASH_BASE,
      change: { media_ids: ['1'] }
    },
    {
      description: 'fitness_file_id',
      base: NOTE_HASH_BASE,
      change: { fitness_file_id: 'fitness-1' }
    },
    {
      description: 'in_reply_to_id',
      base: NOTE_HASH_BASE,
      change: { in_reply_to_id: 'parent-1' }
    },
    {
      description: 'quoted_status_id',
      base: NOTE_HASH_BASE,
      change: { quoted_status_id: 'quoted-1' }
    },
    {
      description: 'quote_approval_policy',
      base: NOTE_HASH_BASE,
      change: { quote_approval_policy: 'followers' }
    },
    {
      description: 'visibility',
      base: NOTE_HASH_BASE,
      change: { visibility: 'unlisted' }
    },
    {
      description: 'spoiler_text',
      base: NOTE_HASH_BASE,
      change: { spoiler_text: 'cw' }
    },
    {
      description: 'sensitive',
      base: NOTE_HASH_BASE,
      change: { sensitive: true }
    },
    {
      description: 'language',
      base: NOTE_HASH_BASE,
      change: { language: 'th' }
    },
    {
      description: 'created_at',
      base: NOTE_HASH_BASE,
      change: { created_at: '2024-01-01T00:00:00.000Z' }
    },
    {
      description: 'poll options',
      base: POLL_HASH_BASE,
      change: { poll: { ...POLL_HASH_BASE.poll, options: ['One', 'Three'] } }
    },
    {
      description: 'poll expires_in',
      base: POLL_HASH_BASE,
      change: { poll: { ...POLL_HASH_BASE.poll, expires_in: 7200 } }
    },
    {
      description: 'poll multiple',
      base: POLL_HASH_BASE,
      change: { poll: { ...POLL_HASH_BASE.poll, multiple: true } }
    },
    {
      description: 'poll hide_totals',
      base: POLL_HASH_BASE,
      change: { poll: { ...POLL_HASH_BASE.poll, hide_totals: true } }
    }
  ])(
    'rejects a reused Idempotency-Key whose $description differs with 422',
    async ({ description, base, change }) => {
      const idempotencyKey = `idem-key-hash-${description}`
      const first = await postStatus(base, idempotencyKey)
      expect(first.status).toBe(200)

      const changed = await postStatus({ ...base, ...change }, idempotencyKey)
      expect(changed.status).toBe(422)
      await expect(changed.json()).resolves.toEqual({
        error: expect.stringContaining('Idempotency-Key')
      })
    }
  )

  it('returns the original status for a legacy key saved without a content hash, whatever the body', async () => {
    const original = await postStatus({ status: 'Legacy keyed status' })
    expect(original.status).toBe(200)
    const originalStatus = await original.json()
    await database.saveIdempotencyKey({
      actorId: ACTOR1_ID,
      key: 'idem-key-legacy-null-hash',
      statusId: originalStatus.uri
    })

    const response = await postStatus(
      { status: 'A different body' },
      'idem-key-legacy-null-hash'
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      id: originalStatus.id
    })
    await expect(statusesWithText('A different body')).resolves.toHaveLength(0)
  })

  it.each([
    {
      description: 'a poll',
      extra: { poll: { options: ['Ride', 'Run'], expires_in: 3600 } }
    },
    {
      description: 'scheduled_at',
      extra: {
        scheduled_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
      }
    }
  ])(
    'rejects fitness_file_id combined with $description with 422',
    async ({ extra }) => {
      const fitnessFile = await database.createFitnessFile({
        actorId: ACTOR1_ID,
        fileName: 'combined.fit',
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1024,
        path: `fitness/combined-${Object.keys(extra)[0]}.fit`
      })

      const response = await postStatus({
        status: 'Fitness combined with something else',
        fitness_file_id: fitnessFile!.id,
        ...extra
      })

      expect(response.status).toBe(422)
      await expect(
        statusesWithText('Fitness combined with something else')
      ).resolves.toHaveLength(0)
    }
  )

  it('accepts fitness_file_id and quote_approval_policy extensions on POST /api/v1/statuses', async () => {
    const fitnessFile = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      fileName: 'ride.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 4096,
      path: 'fitness/ride.fit'
    })
    expect(fitnessFile).toBeDefined()

    const response = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: JSON.stringify({
          status: '',
          fitness_file_id: fitnessFile!.id,
          quote_approval_policy: 'followers'
        }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.fitness).toMatchObject({
      id: fitnessFile!.id,
      fileName: 'ride.fit',
      fileType: 'fit'
    })
    expect(body.quote_approval).toMatchObject({
      automatic: ['followers']
    })

    const invalidPolicyResponse = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: JSON.stringify({
          status: 'Invalid quote policy',
          quote_approval_policy: 'invalid-policy'
        }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test'
        }
      }),
      { params: Promise.resolve({}) }
    )
    expect(invalidPolicyResponse.status).toBe(422)
  })

  it('records the OAuth client as the application on a token-created status', async () => {
    await db
      .insertInto('oauthClient')
      .values({
        id: 'oauth-client-row-1',
        clientId: 'client-test-app',
        name: 'Test App',
        uri: null,
        redirectUris: JSON.stringify(['https://app.example.com/callback']),
        scopes: JSON.stringify(['write'])
      })
      .execute()
    await db
      .insertInto('oauthAccessToken')
      .values({
        id: 'oauth-access-token-1',
        token: hashToken('app-write-token'),
        clientId: 'client-test-app',
        referenceId: ACTOR1_ID,
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['write'])
      })
      .execute()

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
    await db
      .insertInto('oauthClient')
      .values({
        id: 'oauth-client-row-2',
        clientId: 'client-poll-app',
        name: 'Poll App',
        uri: 'https://poll.example.com',
        redirectUris: JSON.stringify(['https://poll.example.com/callback']),
        scopes: JSON.stringify(['write'])
      })
      .execute()
    await db
      .insertInto('oauthAccessToken')
      .values({
        id: 'oauth-access-token-2',
        token: hashToken('poll-write-token'),
        clientId: 'client-poll-app',
        referenceId: ACTOR1_ID,
        expiresAt: new Date(Date.now() + 3600000),
        scopes: JSON.stringify(['write'])
      })
      .execute()

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

  describe('created_at backdating', () => {
    const postStatus = (body: Record<string, unknown>) =>
      POST(
        new NextRequest('https://llun.test/api/v1/statuses', {
          method: 'POST',
          body: JSON.stringify(body),
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://llun.test'
          }
        }),
        { params: Promise.resolve({}) }
      )

    it('backdates the status, its publicId, its attachments and the federated note', async () => {
      const media = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: 'medias/backdated-album-photo.webp',
          bytes: 2048,
          mimeType: 'image/jpeg',
          metaData: { width: 640, height: 480 },
          fileName: 'backdated-album-photo.jpg'
        }
      })
      expect(media).not.toBeNull()

      const response = await postStatus({
        status: 'Photos from the weekend ride',
        media_ids: [media!.id],
        // Same instant as 2026-06-14T18:30:00.000Z, given with an offset.
        created_at: '2026-06-14T20:30:00+02:00'
      })

      expect(response.status).toBe(200)
      const mastodonStatus = await response.json()
      const backdatedAt = Date.parse('2026-06-14T18:30:00.000Z')
      expect(mastodonStatus.created_at).toBe('2026-06-14T18:30:00.000Z')
      // updatedAt is the real write time, but a backdated status is not an edit.
      expect(mastodonStatus.edited_at).toBeNull()

      const status = (await database.getStatus({
        statusId: mastodonStatus.uri,
        withReplies: false
      })) as StatusNote
      expect(status.createdAt).toBe(backdatedAt)
      // The UUIDv7 publicId embeds the backdated time, so id order and
      // createdAt order agree on every timeline.
      expect(mastodonStatus.id).toBe(status.publicId)
      expect(getPublicIdTimestamp(mastodonStatus.id)).toBe(backdatedAt)
      expect(status.attachments.map((item) => item.createdAt)).toEqual([
        backdatedAt
      ])
      expect(getNoteFromStatus(status)?.published).toBe(
        '2026-06-14T18:30:00.000Z'
      )
    })

    it('backdates a poll', async () => {
      const response = await postStatus({
        status: 'Which route next year?',
        poll: { options: ['Coast', 'Mountains'], expires_in: 3600 },
        created_at: '2026-06-14T18:30:00Z'
      })

      expect(response.status).toBe(200)
      const mastodonStatus = await response.json()
      expect(mastodonStatus.created_at).toBe('2026-06-14T18:30:00.000Z')
      expect(getPublicIdTimestamp(mastodonStatus.id)).toBe(
        Date.parse('2026-06-14T18:30:00Z')
      )
      expect(mastodonStatus.poll).not.toBeNull()
    })

    it('accepts created_at from a form-encoded body', async () => {
      const body = new URLSearchParams()
      body.set('status', 'Backdated from a form client')
      body.set('created_at', '2026-06-14T18:30:00Z')

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
      expect(mastodonStatus.created_at).toBe('2026-06-14T18:30:00.000Z')
    })

    it('rejects an invalid created_at', async () => {
      const response = await postStatus({
        status: 'Rejected backdated status',
        created_at: 'last saturday'
      })

      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({
        error: CREATED_AT_INVALID_ERROR
      })
      expect(getQueue().publish).not.toHaveBeenCalled()
    })

    it('rejects created_at combined with scheduled_at', async () => {
      const response = await postStatus({
        status: 'Both backdated and scheduled',
        created_at: '2026-06-14T18:30:00Z',
        scheduled_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
      })

      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({
        error: CREATED_AT_WITH_SCHEDULED_AT_ERROR
      })
      expect(getQueue().publish).not.toHaveBeenCalled()
    })
  })
})

describe('GET /api/v1/statuses', () => {
  const { database, prepare } = createTestDatabase()

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
      await statusPublicId(database, firstId),
      await statusPublicId(database, secondId)
    ])
  })

  it('resolves a whole batch of publicIds with a single database lookup', async () => {
    const spy = vi.spyOn(database, 'getStatusIdsByPublicIds')
    const publicIds = Array.from({ length: 25 }, () => generatePublicId())
    const req = new NextRequest(
      `https://llun.test/api/v1/statuses?${publicIds
        .map((publicId) => `id[]=${publicId}`)
        .join('&')}`
    )
    const response = await GET(req, { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith({ publicIds })
    spy.mockRestore()
  })

  it('truncates an over-cap id list to MAX_BATCH_STATUSES instead of failing', async () => {
    const spy = vi.spyOn(database, 'getStatusIdsByPublicIds')
    const publicIds = Array.from({ length: MAX_BATCH_STATUSES + 20 }, () =>
      generatePublicId()
    )
    const req = new NextRequest(
      `https://llun.test/api/v1/statuses?${publicIds
        .map((publicId) => `id[]=${publicId}`)
        .join('&')}`
    )
    const response = await GET(req, { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith({
      publicIds: publicIds.slice(0, MAX_BATCH_STATUSES)
    })
    spy.mockRestore()
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
