import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { getQueue } from '@/lib/services/queue'
import { invalidateServerSettingsCache } from '@/lib/services/serverSettings'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { StatusType } from '@/lib/types/domain/status'
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

describe('PUT /api/v1/statuses/[id]', () => {
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
