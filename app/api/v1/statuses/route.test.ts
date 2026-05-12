import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { getQueue } from '@/lib/services/queue'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { Status } from '@/lib/types/domain/status'
import { getNoteFromStatus } from '@/lib/utils/getNoteFromStatus'

import { POST } from './route'

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

describe('POST /api/v1/statuses', () => {
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
})
