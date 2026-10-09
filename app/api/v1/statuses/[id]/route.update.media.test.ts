import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import {
  MAX_FEDERATION_MEDIA_ATTACHMENTS,
  MAX_STORED_MEDIA_ATTACHMENTS
} from '@/lib/services/mastodon/constants'
import { getQueue } from '@/lib/services/queue'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { Status, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getNoteFromStatus } from '@/lib/utils/getNoteFromStatus'
import { urlToId } from '@/lib/utils/urlToId'

import { GET as getStatusHistory } from './history/route'
import { PUT } from './route'

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

describe('PUT /api/v1/statuses/[id] media edits', () => {
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
    it('replaces media attachments with a media-only edit and federates the update', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-replace-media`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Media edit target',
        summary: null,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${ACTOR1_ID}/followers`]
      })

      const oldMedia = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: 'medias/api-edit-old.webp',
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 320, height: 240 },
          fileName: 'api-edit-old.jpg'
        },
        description: 'Old media'
      })
      const newMedia = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: 'medias/api-edit-new.webp',
          bytes: 2048,
          mimeType: 'image/png',
          metaData: { width: 640, height: 480 },
          fileName: 'api-edit-new.png'
        },
        description: 'New media'
      })
      expect(oldMedia).not.toBeNull()
      expect(newMedia).not.toBeNull()
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: oldMedia!.original.mimeType,
        url: 'https://llun.test/api/v1/files/medias/api-edit-old.webp',
        width: 320,
        height: 240,
        name: 'Old media',
        mediaId: oldMedia!.id
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              media_ids: [newMedia!.id]
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        {
          params: Promise.resolve({ id: urlToId(statusId) })
        }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.content).toContain('Media edit target')
      expect(data.media_attachments).toHaveLength(1)
      expect(data.media_attachments[0]).toMatchObject({
        type: 'image',
        url: 'https://llun.test/api/v1/files/medias/api-edit-new.webp',
        description: 'New media'
      })

      const attachments = await database.getAttachmentsWithMedia({ statusId })
      expect(attachments).toHaveLength(1)
      expect(attachments[0]).toMatchObject({
        mediaId: String(newMedia!.id),
        url: 'https://llun.test/api/v1/files/medias/api-edit-new.webp',
        name: 'New media'
      })

      const updatedStatus = (await database.getStatus({
        statusId,
        withReplies: false
      })) as Status
      const activityPubNote = getNoteFromStatus(updatedStatus)
      expect(activityPubNote?.attachment).toEqual([
        expect.objectContaining({
          mediaType: 'image/png',
          url: 'https://llun.test/api/v1/files/medias/api-edit-new.webp',
          name: 'New media'
        })
      ])
      expect(getQueue().publish).toHaveBeenCalledTimes(1)
    })

    it('stores more media than the federation cap and federates only the first few', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-many-media`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Fitness ride with a full photo set',
        summary: null,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${ACTOR1_ID}/followers`]
      })

      const storedCount = MAX_FEDERATION_MEDIA_ATTACHMENTS + 1
      const mediaIds: string[] = []
      for (let index = 0; index < storedCount; index += 1) {
        const media = await database.createMedia({
          actorId: ACTOR1_ID,
          original: {
            path: `medias/api-edit-many-${index}.webp`,
            bytes: 1024,
            mimeType: 'image/jpeg',
            metaData: { width: 320, height: 240 },
            fileName: `api-edit-many-${index}.jpg`
          },
          description: `Ride photo ${index}`
        })
        expect(media).not.toBeNull()
        mediaIds.push(media!.id)
      }

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({ media_ids: mediaIds }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)

      // The local Mastodon API returns every stored attachment...
      const data = await response.json()
      expect(data.media_attachments).toHaveLength(storedCount)

      const attachments = await database.getAttachmentsWithMedia({ statusId })
      expect(attachments).toHaveLength(storedCount)

      // ...while the outbound ActivityPub note is trimmed to the federation cap.
      const updatedStatus = (await database.getStatus({
        statusId,
        withReplies: false
      })) as Status
      const activityPubNote = getNoteFromStatus(updatedStatus)
      const federatedAttachments = Array.isArray(activityPubNote?.attachment)
        ? activityPubNote.attachment
        : []
      expect(federatedAttachments).toHaveLength(
        MAX_FEDERATION_MEDIA_ATTACHMENTS
      )
    })

    it('attaches a full photo set to a fitness ride and keeps the route map', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-fitness-photos`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Morning ride',
        summary: null,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${ACTOR1_ID}/followers`]
      })
      // The route map is a media-manager image upload, mirroring the fitness
      // import job (processFitnessFileJob stores it via saveMedia).
      const mapMedia = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: 'medias/ride-route-map.webp',
          bytes: 2048,
          mimeType: 'image/png',
          metaData: { width: 640, height: 480 },
          fileName: 'ride-route-map.png'
        },
        description: 'Activity route map'
      })
      expect(mapMedia).not.toBeNull()
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: 'image/png',
        url: 'https://llun.test/api/v1/files/medias/ride-route-map.webp',
        width: 640,
        height: 480,
        name: 'Activity route map',
        mediaId: mapMedia!.id
      })

      const photoCount = MAX_FEDERATION_MEDIA_ATTACHMENTS
      const photoMediaIds: string[] = []
      for (let index = 0; index < photoCount; index += 1) {
        const media = await database.createMedia({
          actorId: ACTOR1_ID,
          original: {
            path: `medias/ride-photo-${index}.webp`,
            bytes: 1024,
            mimeType: 'image/jpeg',
            metaData: { width: 320, height: 240 },
            fileName: `ride-photo-${index}.jpg`
          },
          description: `Ride photo ${index}`
        })
        expect(media).not.toBeNull()
        photoMediaIds.push(media!.id)
      }

      // A correct client re-sends the existing map alongside the new photos, so
      // the edited set (map + photos) is larger than the federation cap.
      const mediaIds = [mapMedia!.id, ...photoMediaIds]

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({ media_ids: mediaIds }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)

      // Every photo plus the route map remain on the status.
      const updatedStatus = await database.getStatus({
        statusId,
        withReplies: false
      })
      expect(updatedStatus?.type).toBe(StatusType.enum.Note)
      if (!updatedStatus || updatedStatus.type !== StatusType.enum.Note) {
        throw new Error('Expected note status')
      }
      expect(updatedStatus.attachments).toHaveLength(mediaIds.length)
      expect(
        updatedStatus.attachments.some(
          (attachment) => attachment.name === 'Activity route map'
        )
      ).toBe(true)

      // The federated note is still trimmed to the Mastodon cap.
      const activityPubNote = getNoteFromStatus(updatedStatus)
      const federatedAttachments = Array.isArray(activityPubNote?.attachment)
        ? activityPubNote.attachment
        : []
      expect(federatedAttachments).toHaveLength(
        MAX_FEDERATION_MEDIA_ATTACHMENTS
      )
    })

    it('rejects more media_ids than the stored ceiling with 422', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-over-ceiling`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Over the stored ceiling',
        summary: null,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${ACTOR1_ID}/followers`]
      })

      const mediaIds = Array.from(
        { length: MAX_STORED_MEDIA_ATTACHMENTS + 1 },
        (_, index) => `over-ceiling-media-${index}`
      )

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({ media_ids: mediaIds }),
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

    it('rejects more media_attributes than the stored ceiling with 422', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-attributes-over-ceiling`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Over the stored ceiling with attributes',
        summary: null,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${ACTOR1_ID}/followers`]
      })

      // Every attribute references an owned, resolvable media, so without the
      // ceiling each one would trigger a database.updateMedia write — the
      // unbounded fan-out this guards against.
      const mediaAttributes = []
      for (
        let index = 0;
        index < MAX_STORED_MEDIA_ATTACHMENTS + 1;
        index += 1
      ) {
        const media = await database.createMedia({
          actorId: ACTOR1_ID,
          original: {
            path: `medias/attr-ceiling-${index}.webp`,
            bytes: 1024,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 },
            fileName: `attr-ceiling-${index}.jpg`
          }
        })
        expect(media).not.toBeNull()
        mediaAttributes.push({ id: media!.id, description: `Photo ${index}` })
      }

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({ media_attributes: mediaAttributes }),
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

    it('clears media attachments with an empty media id list', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-clear-media`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Clear media target',
        summary: null,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const media = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: 'medias/api-edit-clear.webp',
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 320, height: 240 },
          fileName: 'api-edit-clear.jpg'
        },
        description: 'Clear media'
      })
      expect(media).not.toBeNull()
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: media!.original.mimeType,
        url: 'https://llun.test/api/v1/files/medias/api-edit-clear.webp',
        width: 320,
        height: 240,
        name: 'Clear media',
        mediaId: media!.id
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              media_ids: []
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        {
          params: Promise.resolve({ id: urlToId(statusId) })
        }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.media_attachments).toEqual([])
      await expect(database.getAttachments({ statusId })).resolves.toEqual([])
      expect(getQueue().publish).toHaveBeenCalledTimes(1)
    })

    it('allows clearing editable media from a blank note when legacy attachments remain', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-clear-media-keep-legacy`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: '',
        summary: null,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const media = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: 'medias/api-edit-clear-legacy-editable.webp',
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 320, height: 240 },
          fileName: 'api-edit-clear-legacy-editable.jpg'
        },
        description: 'Editable media'
      })
      expect(media).not.toBeNull()
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: media!.original.mimeType,
        url: 'https://llun.test/api/v1/files/medias/api-edit-clear-legacy-editable.webp',
        width: 320,
        height: 240,
        name: 'Editable media',
        mediaId: media!.id
      })
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: 'image/jpeg',
        url: 'https://remote.example/legacy.jpg',
        width: 640,
        height: 480,
        name: 'Legacy media'
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              status: '   ',
              media_ids: []
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        {
          params: Promise.resolve({ id: urlToId(statusId) })
        }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.media_attachments).toHaveLength(1)
      expect(data.media_attachments[0]).toMatchObject({
        type: 'image',
        url: 'https://remote.example/legacy.jpg',
        description: 'Legacy media'
      })

      const attachments = await database.getAttachments({ statusId })
      expect(attachments).toHaveLength(1)
      expect(attachments[0]).toMatchObject({
        mediaId: null,
        url: 'https://remote.example/legacy.jpg',
        name: 'Legacy media'
      })
      expect(getQueue().publish).toHaveBeenCalledTimes(1)
    })

    it('rejects clearing media from a media-only note without partial mutation', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-reject-clear-media-only`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: '',
        summary: null,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const media = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: 'medias/api-edit-reject-clear-media-only.webp',
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 320, height: 240 },
          fileName: 'api-edit-reject-clear-media-only.jpg'
        },
        description: 'Only media'
      })
      expect(media).not.toBeNull()
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: media!.original.mimeType,
        url: 'https://llun.test/api/v1/files/medias/api-edit-reject-clear-media-only.webp',
        width: 320,
        height: 240,
        name: 'Only media',
        mediaId: media!.id
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              media_ids: []
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        {
          params: Promise.resolve({ id: urlToId(statusId) })
        }
      )

      const updatedStatus = await database.getStatus({ statusId })
      const attachments = await database.getAttachments({ statusId })

      expect(response.status).toBe(422)
      expect(updatedStatus?.type).toBe(StatusType.enum.Note)
      if (!updatedStatus || updatedStatus.type !== StatusType.enum.Note) {
        throw new Error('Expected note status')
      }
      expect(updatedStatus.text).toBe('')
      expect(attachments).toHaveLength(1)
      expect(attachments[0]).toMatchObject({
        url: 'https://llun.test/api/v1/files/medias/api-edit-reject-clear-media-only.webp',
        name: 'Only media'
      })
      expect(getQueue().publish).not.toHaveBeenCalled()
    })

    it('rejects blank status with empty media ids without partial mutation', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-reject-blank-clear-media`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Original text before rejected edit',
        summary: null,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const media = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: 'medias/api-edit-reject-blank-clear-media.webp',
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 320, height: 240 },
          fileName: 'api-edit-reject-blank-clear-media.jpg'
        },
        description: 'Preserved media'
      })
      expect(media).not.toBeNull()
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: media!.original.mimeType,
        url: 'https://llun.test/api/v1/files/medias/api-edit-reject-blank-clear-media.webp',
        width: 320,
        height: 240,
        name: 'Preserved media',
        mediaId: media!.id
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              status: '   ',
              media_ids: []
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        {
          params: Promise.resolve({ id: urlToId(statusId) })
        }
      )

      const updatedStatus = await database.getStatus({ statusId })
      const attachments = await database.getAttachments({ statusId })

      expect(response.status).toBe(422)
      expect(updatedStatus?.type).toBe(StatusType.enum.Note)
      if (!updatedStatus || updatedStatus.type !== StatusType.enum.Note) {
        throw new Error('Expected note status')
      }
      expect(updatedStatus.text).toBe('Original text before rejected edit')
      expect(attachments).toHaveLength(1)
      expect(attachments[0]).toMatchObject({
        url: 'https://llun.test/api/v1/files/medias/api-edit-reject-blank-clear-media.webp',
        name: 'Preserved media'
      })
      expect(getQueue().publish).not.toHaveBeenCalled()
    })

    it('does not partially apply text changes when media ids are forbidden', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-forbidden-media`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Original media ownership text',
        summary: null,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const foreignMedia = await database.createMedia({
        actorId: ACTOR2_ID,
        original: {
          path: 'medias/api-edit-foreign.webp',
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 320, height: 240 },
          fileName: 'api-edit-foreign.jpg'
        },
        description: 'Foreign media'
      })
      expect(foreignMedia).not.toBeNull()

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              status: 'Should not be applied',
              media_ids: [foreignMedia!.id]
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        {
          params: Promise.resolve({ id: urlToId(statusId) })
        }
      )

      const updatedStatus = await database.getStatus({ statusId })
      expect(response.status).toBe(422)
      expect(updatedStatus?.type).toBe(StatusType.enum.Note)
      if (!updatedStatus || updatedStatus.type !== StatusType.enum.Note) {
        throw new Error('Expected note status')
      }
      expect(updatedStatus.text).toBe('Original media ownership text')
      expect(getQueue().publish).not.toHaveBeenCalled()
    })

    it.each([
      { label: 'visibility-only', body: { visibility: 'public' } },
      {
        label: 'visibility and text',
        body: { visibility: 'public', status: 'redacted' }
      }
    ])(
      'does not expose a followers-only revision after a $label widening edit',
      async ({ label, body }) => {
        const statusId = `${ACTOR1_ID}/statuses/api-widen-history-${label.replace(/\W+/g, '-')}`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: ACTOR1_ID,
          text: 'followers-only secret',
          to: [`${ACTOR1_ID}/followers`],
          cc: []
        })
        // An earlier edit while still followers-only leaves a revision whose
        // text only followers were ever meant to read.
        await database.updateNote({ statusId, text: 'followers-only v2' })

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
        expect(response.status).toBe(200)
        const updated = await response.json()
        expect(updated.visibility).toBe('public')

        mockGetServerSession.mockResolvedValue(null)
        const historyResponse = await getStatusHistory(
          new NextRequest(
            `https://llun.test/api/v1/statuses/${urlToId(statusId)}/history`
          ),
          { params: Promise.resolve({ id: urlToId(statusId) }) }
        )
        expect(historyResponse.status).toBe(200)
        // Only the now-public current version: no revision written for the
        // followers-only audience survives the widening.
        const history = await historyResponse.json()
        expect(
          history.map((edit: { content: string }) => edit.content)
        ).toEqual([updated.content])
        expect(JSON.stringify(history)).not.toContain('followers-only secret')
      }
    )
  })
})
