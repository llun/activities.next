import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

import { GET, PUT } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', async () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', async () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', async () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', async () => ({
  verifyBearerToken: vi.fn()
}))

vi.mock('@/lib/services/queue', async () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

// No `deleteStatus` here on purpose: status deletion federates through
// SendDeleteNoteJob now, so the request path never reaches the sender.
vi.mock('@/lib/activities', async () => ({
  sendLike: vi.fn().mockResolvedValue(undefined),
  sendUndoLike: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/lib/services/medias', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/medias')>()),
  deleteMediaFile: vi.fn().mockResolvedValue(true)
}))

vi.mock('@/lib/config', async () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

describe('PUT /api/v1/statuses/[id] media attachments', () => {
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

  describe('status update', () => {
    it('rejects media_ids and media_attributes naming a sibling actor’s media', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-sibling-media`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Sibling media target',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const actor1 = await database.getActorFromId({ id: ACTOR1_ID })
      const siblingId = await database.createActorForAccount({
        accountId: actor1!.account!.id,
        username: 'api-edit-sibling',
        domain: TEST_DOMAIN,
        privateKey: 'privateKey-api-edit-sibling',
        publicKey: 'publicKey-api-edit-sibling'
      })
      const siblingMedia = await database.createMedia({
        actorId: siblingId,
        original: {
          path: 'medias/api-edit-sibling.webp',
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 320, height: 240 }
        },
        description: 'Sibling secret'
      })

      for (const body of [
        { media_ids: [siblingMedia!.id] },
        {
          media_attributes: [
            { id: siblingMedia!.id, description: 'overwritten by actor1' }
          ]
        }
      ]) {
        const response = await PUT(
          new NextRequest(
            `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
            {
              method: 'PUT',
              body: JSON.stringify(body),
              headers: {
                'Content-Type': 'application/json',
                Origin: 'https://llun.test'
              }
            }
          ),
          { params: Promise.resolve({ id: urlToId(statusId) }) }
        )
        expect(response.status).toBe(422)
      }

      const unchanged = await database.getMediaByIdForAccount({
        mediaId: siblingMedia!.id,
        accountId: actor1!.account!.id
      })
      expect(unchanged?.description).toBe('Sibling secret')
      expect(await database.getAttachments({ statusId })).toEqual([])
    })

    it('updates attachment description and focus through media_attributes', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-media-attributes`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Media attributes target',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const media = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: 'medias/api-edit-attributes.webp',
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 320, height: 240 },
          fileName: 'api-edit-attributes.jpg'
        },
        description: 'Old description'
      })
      expect(media).not.toBeNull()
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: media!.original.mimeType,
        url: 'https://llun.test/api/v1/files/medias/api-edit-attributes.webp',
        width: 320,
        height: 240,
        name: 'Old description',
        mediaId: media!.id
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              media_attributes: [
                {
                  id: media!.id,
                  description: 'New description',
                  focus: '0.5,-0.5'
                }
              ]
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.media_attachments).toHaveLength(1)
      expect(data.media_attachments[0]).toMatchObject({
        description: 'New description'
      })

      const actor = await database.getActorFromId({ id: ACTOR1_ID })
      const updatedMedia = await database.getMediaByIdForAccount({
        mediaId: media!.id,
        accountId: actor!.account!.id
      })
      expect(updatedMedia?.description).toBe('New description')
      expect(updatedMedia?.focus).toEqual({ x: 0.5, y: -0.5 })
    })

    // The only id a third-party client can send. The status entity publishes
    // `media_attachments[].id` as the ATTACHMENT row's uuid while every media
    // path addresses the numeric `medias` row id, so an id read back off the
    // status used to fail `toMediaRowId` and answer 422 — the Mastodon
    // focal-point editor could not reach the media row at all. Every other
    // test here passes `media!.id`, which only this app's own composer sends.

    it('accepts the attachment id the status entity published for media_attributes', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-published-attachment-id`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Published id target',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const media = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: 'medias/api-edit-published-id.webp',
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 320, height: 240 },
          fileName: 'api-edit-published-id.jpg'
        },
        description: 'Published id description'
      })
      expect(media).not.toBeNull()
      const attachment = await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: media!.original.mimeType,
        url: 'https://llun.test/api/v1/files/medias/api-edit-published-id.webp',
        width: 320,
        height: 240,
        name: 'Published id description',
        mediaId: media!.id
      })
      // What a client reads back from the status, and never the media row id.
      expect(attachment.id).not.toEqual(media!.id)

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              media_attributes: [{ id: attachment.id, focus: '0.25,-0.75' }]
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.media_attachments[0].meta).toMatchObject({
        focus: { x: 0.25, y: -0.75 }
      })

      const actor = await database.getActorFromId({ id: ACTOR1_ID })
      const updatedMedia = await database.getMediaByIdForAccount({
        mediaId: media!.id,
        accountId: actor!.account!.id
      })
      expect(updatedMedia?.focus).toEqual({ x: 0.25, y: -0.75 })
    })

    // Both id forms name the same attachment, so the edit is a no-op that
    // leaves exactly one attachment. Pins the client-visible result of mixing
    // them, which is now accepted rather than answered 422.

    it('attaches media once when media_ids carries both the attachment id and the media id', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-both-id-forms`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Both id forms target',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const media = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: 'medias/api-edit-both-id-forms.webp',
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 320, height: 240 },
          fileName: 'api-edit-both-id-forms.jpg'
        },
        description: 'Both id forms'
      })
      expect(media).not.toBeNull()
      const attachment = await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: media!.original.mimeType,
        url: 'https://llun.test/api/v1/files/medias/api-edit-both-id-forms.webp',
        width: 320,
        height: 240,
        name: 'Both id forms',
        mediaId: media!.id
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              media_ids: [attachment.id, media!.id]
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.media_attachments).toHaveLength(1)
      expect(await database.getAttachments({ statusId })).toHaveLength(1)
    })

    // An audio upload has no dimensions or duration to serialise, so it used to
    // come back as a bare `null` — which `Mastodon.Status.parse` rejects, so
    // the whole status failed to serialise: dropped from timelines as
    // un-hydratable and an error on this very GET. Published as Mastodon's
    // `unknown` type it serialises, and carrying an id is what lets an editing
    // client name it and keep it.

    it('keeps an audio attachment through an edit that echoes the published ids', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-unknown-type-attachment`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Mixed media target',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const image = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: 'medias/api-edit-mixed-image.webp',
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 320, height: 240 },
          fileName: 'api-edit-mixed-image.jpg'
        }
      })
      const audio = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: 'medias/api-edit-mixed-audio.m4a',
          bytes: 2048,
          mimeType: 'audio/mp4',
          metaData: { width: 0, height: 0 },
          fileName: 'api-edit-mixed-audio.m4a'
        }
      })
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: 'image/jpeg',
        url: 'https://llun.test/api/v1/files/medias/api-edit-mixed-image.webp',
        width: 320,
        height: 240,
        name: 'Mixed image',
        mediaId: image!.id
      })
      const audioAttachment = await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: 'audio/mp4',
        url: 'https://llun.test/api/v1/files/medias/api-edit-mixed-audio.m4a',
        name: 'Mixed audio',
        mediaId: audio!.id
      })

      const published = await GET(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          { headers: { Origin: 'https://llun.test' } }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )
      const publishedData = await published.json()
      // Every attachment is addressable: none serialises as a bare null.
      expect(publishedData.media_attachments).toHaveLength(2)
      expect(publishedData.media_attachments).not.toContain(null)
      const publishedIds = publishedData.media_attachments.map(
        (attachment: { id: string }) => attachment.id
      )
      expect(publishedIds).toContain(audioAttachment.id)

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              status: 'Mixed media edited',
              media_ids: publishedIds
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)
      const attachments = await database.getAttachments({ statusId })
      expect(attachments).toHaveLength(2)
      expect(
        attachments.some((attachment) => attachment.mediaType === 'audio/mp4')
      ).toBe(true)
    })

    it('keeps the existing description when media_attributes only updates focus', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-media-attributes-focus`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Focus only target',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const media = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: 'medias/api-edit-attributes-focus.webp',
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 320, height: 240 },
          fileName: 'api-edit-attributes-focus.jpg'
        },
        description: 'Keep description'
      })
      expect(media).not.toBeNull()
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: media!.original.mimeType,
        url: 'https://llun.test/api/v1/files/medias/api-edit-attributes-focus.webp',
        width: 320,
        height: 240,
        name: 'Keep description',
        mediaId: media!.id
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              media_attributes: [{ id: media!.id, focus: '0,1' }]
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)
      const actor = await database.getActorFromId({ id: ACTOR1_ID })
      const updatedMedia = await database.getMediaByIdForAccount({
        mediaId: media!.id,
        accountId: actor!.account!.id
      })
      // An omitted description must be left untouched (not cleared to null).
      expect(updatedMedia?.description).toBe('Keep description')
      expect(updatedMedia?.focus).toEqual({ x: 0, y: 1 })
    })

    it('clears an attachment description when media_attributes sends description null', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-media-attributes-clear`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Clear description target',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const media = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: 'medias/api-edit-attributes-clear.webp',
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 320, height: 240 },
          fileName: 'api-edit-attributes-clear.jpg'
        },
        description: 'Alt text to clear'
      })
      expect(media).not.toBeNull()
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: media!.original.mimeType,
        url: 'https://llun.test/api/v1/files/medias/api-edit-attributes-clear.webp',
        width: 320,
        height: 240,
        name: 'Alt text to clear',
        mediaId: media!.id
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              media_attributes: [{ id: media!.id, description: null }]
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)
      const actor = await database.getActorFromId({ id: ACTOR1_ID })
      const updatedMedia = await database.getMediaByIdForAccount({
        mediaId: media!.id,
        accountId: actor!.account!.id
      })
      // Explicit null clears the stored alt text (blank/null normalise to null).
      expect(updatedMedia?.description ?? null).toBeNull()
    })

    it('rejects media_attributes for media the actor does not own', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-media-attributes-foreign`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Foreign media attributes target',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const foreignMedia = await database.createMedia({
        actorId: ACTOR2_ID,
        original: {
          path: 'medias/api-edit-attributes-foreign.webp',
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 320, height: 240 },
          fileName: 'api-edit-attributes-foreign.jpg'
        }
      })
      expect(foreignMedia).not.toBeNull()

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              media_attributes: [
                { id: foreignMedia!.id, description: 'Hijacked' }
              ]
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(422)
    })
  })
})
