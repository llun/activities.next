import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import {
  MAX_FEDERATION_MEDIA_ATTACHMENTS,
  MAX_STORED_MEDIA_ATTACHMENTS
} from '@/lib/services/mastodon/constants'
import { getQueue } from '@/lib/services/queue'
import { invalidateServerSettingsCache } from '@/lib/services/serverSettings'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { Status, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getNoteFromStatus } from '@/lib/utils/getNoteFromStatus'
import { urlToId } from '@/lib/utils/urlToId'

import { GET as getStatusHistory } from './history/route'
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

describe('GET /api/v1/statuses/[id]', () => {
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

    it('rejects an edit over the configured character limit with 422', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      const statusId = `${ACTOR1_ID}/statuses/api-edit-length-limit`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Short',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.setServerSetting({ key: 'posts.maxCharacters', value: 10 })
      invalidateServerSettingsCache(database)

      try {
        const response = await PUT(
          new NextRequest(
            `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
            {
              method: 'PUT',
              body: JSON.stringify({ status: 'x'.repeat(11) }),
              headers: {
                'Content-Type': 'application/json',
                Origin: 'https://llun.test'
              }
            }
          ),
          { params: Promise.resolve({ id: urlToId(statusId) }) }
        )
        expect(response.status).toBe(422)
      } finally {
        await database.deleteServerSetting({ key: 'posts.maxCharacters' })
        invalidateServerSettingsCache(database)
      }
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

    it('applies visibility updates when spoiler_text is also present', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-visibility-with-cw`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Public edit target',
        summary: 'Existing warning',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${ACTOR1_ID}/followers`]
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              visibility: 'private',
              spoiler_text: ''
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
      const updatedStatus = await database.getStatus({ statusId })

      expect(data.visibility).toBe('private')
      expect(data.spoiler_text).toBe('')
      expect(updatedStatus?.type).toBe(StatusType.enum.Note)
      if (!updatedStatus || updatedStatus.type !== StatusType.enum.Note) {
        throw new Error('Expected note status')
      }
      expect(updatedStatus.summary).toBeNull()
      expect(updatedStatus?.to).toEqual([`${ACTOR1_ID}/followers`])
      expect(updatedStatus?.cc).toEqual([])
      expect(getQueue().publish).toHaveBeenCalledTimes(1)
    })

    it('edits text from a urlencoded body without wiping unmentioned media (native clients)', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-urlencoded-keep-media`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Original urlencoded text',
        summary: null,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const media = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: 'medias/api-edit-urlencoded-keep.webp',
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 320, height: 240 },
          fileName: 'api-edit-urlencoded-keep.jpg'
        },
        description: 'Kept media'
      })
      expect(media).not.toBeNull()
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: media!.original.mimeType,
        url: 'https://llun.test/api/v1/files/medias/api-edit-urlencoded-keep.webp',
        width: 320,
        height: 240,
        name: 'Kept media',
        mediaId: media!.id
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            // Only `status` is sent — `media_ids` is absent. The omit-if-absent
            // parser must leave it undefined so existing media is preserved
            // rather than coerced to an empty array and wiped.
            body: new URLSearchParams({
              status: 'Edited via urlencoded'
            }).toString(),
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
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
      expect(data.content).toContain('Edited via urlencoded')
      expect(data.media_attachments).toHaveLength(1)
      const attachments = await database.getAttachments({ statusId })
      expect(attachments).toHaveLength(1)
    })

    it('clears media from a urlencoded body with an explicit empty media_ids[]', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-urlencoded-clear-media`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Keeps text while clearing media',
        summary: null,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const media = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: 'medias/api-edit-urlencoded-clear.webp',
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 320, height: 240 },
          fileName: 'api-edit-urlencoded-clear.jpg'
        },
        description: 'Cleared media'
      })
      expect(media).not.toBeNull()
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: media!.original.mimeType,
        url: 'https://llun.test/api/v1/files/medias/api-edit-urlencoded-clear.webp',
        width: 320,
        height: 240,
        name: 'Cleared media',
        mediaId: media!.id
      })

      // `media_ids[]=` (present but empty) must clear attachments, mirroring a
      // JSON `media_ids: []`, rather than being dropped as absent.
      const params = new URLSearchParams({
        status: 'Keeps text while clearing'
      })
      params.append('media_ids[]', '')

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: params.toString(),
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
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
    })

    it('returns 400 for a malformed JSON edit body', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-malformed-json`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Malformed edit target',
        summary: null,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            // Syntactically broken JSON must surface as 400 (bad request), not a
            // 422 from a swallowed empty body.
            body: '{ "status": "oops" ',
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

      expect(response.status).toBe(400)
      const updatedStatus = await database.getStatus({ statusId })
      expect(updatedStatus?.type).toBe(StatusType.enum.Note)
      if (!updatedStatus || updatedStatus.type !== StatusType.enum.Note) {
        throw new Error('Expected note status')
      }
      expect(updatedStatus.text).toBe('Malformed edit target')
    })

    it('applies a visibility-only edit from a urlencoded body', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-urlencoded-visibility`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Visibility urlencoded target',
        summary: null,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${ACTOR1_ID}/followers`]
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: new URLSearchParams({ visibility: 'private' }).toString(),
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
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
      expect(data.visibility).toBe('private')
      // Text must survive a visibility-only edit (status omitted, not blanked).
      expect(data.content).toContain('Visibility urlencoded target')
    })

    it('clears content warning when spoiler_text is null', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-null-cw`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Content warning target',
        summary: 'Existing warning',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${ACTOR1_ID}/followers`]
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              spoiler_text: null
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
      const updatedStatus = await database.getStatus({ statusId })

      expect(data.spoiler_text).toBe('')
      expect(updatedStatus?.type).toBe(StatusType.enum.Note)
      if (!updatedStatus || updatedStatus.type !== StatusType.enum.Note) {
        throw new Error('Expected note status')
      }
      expect(updatedStatus.summary).toBeNull()
    })

    it('does not partially apply visibility when content update is forbidden', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor2.email }
      })
      const statusId = `${ACTOR1_ID}/statuses/api-edit-forbidden-combined`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Public edit target',
        summary: 'Existing warning',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${ACTOR1_ID}/followers`]
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              visibility: 'private',
              spoiler_text: ''
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

      expect(response.status).toBe(403)
      expect(updatedStatus?.type).toBe(StatusType.enum.Note)
      if (!updatedStatus || updatedStatus.type !== StatusType.enum.Note) {
        throw new Error('Expected note status')
      }
      expect(updatedStatus.summary).toBe('Existing warning')
      expect(updatedStatus?.to).toEqual([ACTIVITY_STREAM_PUBLIC])
      expect(updatedStatus?.cc).toEqual([`${ACTOR1_ID}/followers`])
      expect(getQueue().publish).not.toHaveBeenCalled()
    })

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

    it('edits poll options with vote reset and snapshots the old options in history', async () => {
      const pollId = `${ACTOR1_ID}/statuses/api-edit-poll-options`
      await database.createPoll({
        id: pollId,
        url: pollId,
        actorId: ACTOR1_ID,
        text: 'Editable poll',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        choices: ['Old A', 'Old B'],
        endAt: Date.now() + 60_000
      })
      await database.recordPollVotes({
        statusId: pollId,
        actorId: ACTOR2_ID,
        choices: [0]
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(pollId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              status: 'Editable poll v2',
              poll: {
                options: ['New A', 'New B'],
                expires_in: 7200,
                hide_totals: true
              }
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(pollId) }) }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.content).toContain('Editable poll v2')
      // Replaced options start from zero and hide_totals nulls the running
      // tallies per option.
      expect(data.poll.options).toEqual([
        { title: 'New A', votes_count: null },
        { title: 'New B', votes_count: null }
      ])
      expect(data.poll.votes_count).toBe(0)
      expect(data.poll.voters_count).toBe(0)
      // expires_in (7200s) is rebased from now into expires_at (seconds -> ms).
      const expiresAt = new Date(data.poll.expires_at).getTime()
      expect(Math.abs(expiresAt - (Date.now() + 7200 * 1000))).toBeLessThan(
        60_000
      )

      const historyResponse = await getStatusHistory(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(pollId)}/history`
        ),
        { params: Promise.resolve({ id: urlToId(pollId) }) }
      )
      const revisions = await historyResponse.json()
      expect(revisions).toHaveLength(2)
      expect(revisions[0].poll).toEqual({
        options: [{ title: 'Old A' }, { title: 'Old B' }]
      })
      expect(revisions[1].poll).toEqual({
        options: [{ title: 'New A' }, { title: 'New B' }]
      })
    })

    it('keeps existing votes when only hide_totals changes on a poll edit', async () => {
      const pollId = `${ACTOR1_ID}/statuses/api-edit-poll-hide-totals-only`
      await database.createPoll({
        id: pollId,
        url: pollId,
        actorId: ACTOR1_ID,
        text: 'Hide totals only poll',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        choices: ['Yes', 'No'],
        endAt: Date.now() + 60_000
      })
      await database.recordPollVotes({
        statusId: pollId,
        actorId: ACTOR2_ID,
        choices: [0]
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(pollId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              poll: { options: ['Yes', 'No'], hide_totals: true }
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(pollId) }) }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      // Votes survive; hide_totals only masks the per-option numbers.
      expect(data.poll.votes_count).toBe(1)
      expect(data.poll.voters_count).toBe(1)
      expect(data.poll.options).toEqual([
        { title: 'Yes', votes_count: null },
        { title: 'No', votes_count: null }
      ])
    })

    it('resets votes and switches to anyOf when a poll edit flips multiple to true', async () => {
      const pollId = `${ACTOR1_ID}/statuses/api-edit-poll-multiple-flip`
      await database.createPoll({
        id: pollId,
        url: pollId,
        actorId: ACTOR1_ID,
        text: 'Single choice poll',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        choices: ['Red', 'Blue'],
        endAt: Date.now() + 60_000
      })
      await database.recordPollVotes({
        statusId: pollId,
        actorId: ACTOR2_ID,
        choices: [0]
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(pollId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              poll: { options: ['Red', 'Blue'], multiple: true }
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(pollId) }) }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      // Same options, but flipping the multiple-choice mode resets votes and
      // switches the poll to anyOf (Mastodon UpdateStatusService#update_poll!).
      expect(data.poll.multiple).toBe(true)
      expect(data.poll.votes_count).toBe(0)
      expect(data.poll.voters_count).toBe(0)
    })

    it.each([
      {
        description: 'a poll payload on a note edit',
        body: { poll: { options: ['A', 'B'] } }
      }
    ])('rejects $description with 422', async ({ body }) => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-note-no-poll`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Note cannot gain a poll',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

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
    })

    it.each([
      { param: 'media_ids', body: { media_ids: ['1'] } },
      {
        param: 'media_attributes',
        body: { media_attributes: [{ id: '1', description: 'x' }] }
      },
      { param: 'visibility', body: { visibility: 'private' } }
    ])(
      'rejects a poll edit that also changes $param with 422',
      async ({ param, body }) => {
        const pollId = `${ACTOR1_ID}/statuses/api-edit-poll-reject-${param}`
        await database.createPoll({
          id: pollId,
          url: pollId,
          actorId: ACTOR1_ID,
          text: 'Poll cannot change media or visibility',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          choices: ['Yes', 'No'],
          endAt: Date.now() + 60_000
        })

        const response = await PUT(
          new NextRequest(
            `https://llun.test/api/v1/statuses/${urlToId(pollId)}`,
            {
              method: 'PUT',
              body: JSON.stringify(body),
              headers: {
                'Content-Type': 'application/json',
                Origin: 'https://llun.test'
              }
            }
          ),
          { params: Promise.resolve({ id: urlToId(pollId) }) }
        )

        expect(response.status).toBe(422)
      }
    )

    it('allows a poll edit that carries an empty media_ids array', async () => {
      const pollId = `${ACTOR1_ID}/statuses/api-edit-poll-empty-media`
      await database.createPoll({
        id: pollId,
        url: pollId,
        actorId: ACTOR1_ID,
        text: 'Poll with an empty media edit',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        choices: ['Yes', 'No'],
        endAt: Date.now() + 60_000
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(pollId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              // Many clients send an empty media_ids by default; on a poll edit
              // that must be ignored, not rejected with 422.
              media_ids: [],
              poll: { options: ['Yes', 'No'], hide_totals: true }
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(pollId) }) }
      )

      expect(response.status).toBe(200)
    })
  })

  describe('edit sensitive/language', () => {
    it('wires sensitive and language through a PUT edit', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-sensitive-language`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Edit me to mark sensitive',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({ sensitive: true, language: 'th' }),
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
      expect(data.sensitive).toBe(true)
      expect(data.language).toBe('th')

      // Persisted through a fresh read.
      const reread = await GET(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )
      await expect(reread.json()).resolves.toMatchObject({
        sensitive: true,
        language: 'th'
      })
    })
  })
})
