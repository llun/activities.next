import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { SEND_DELETE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { deleteMediaFile } from '@/lib/services/medias'
import { getQueue } from '@/lib/services/queue'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

import { DELETE } from './route'

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

  describe('status delete', () => {
    const createNoteWithMedia = async (suffix: string) => {
      const statusId = `${ACTOR1_ID}/statuses/api-delete-${suffix}`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Delete target',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const media = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: `medias/api-delete-${suffix}.webp`,
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 320, height: 240 },
          fileName: `api-delete-${suffix}.jpg`
        },
        thumbnail: {
          path: `medias/api-delete-${suffix}-thumb.webp`,
          bytes: 128,
          mimeType: 'image/webp',
          metaData: { width: 32, height: 24 }
        }
      })
      expect(media).not.toBeNull()
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: media!.original.mimeType,
        url: `https://llun.test/api/v1/files/medias/api-delete-${suffix}.webp`,
        width: 320,
        height: 240,
        name: 'Delete media',
        mediaId: media!.id
      })
      return { statusId, media: media! }
    }

    // `vi.clearAllMocks()` in the suite's beforeEach clears call history but NOT
    // implementations, so a `mockImplementation` set by one test here would
    // otherwise stay installed for the remaining ~800 tests in this file.
    // `mockReset()` alone is not enough: the module mock is created as
    // `vi.fn().mockResolvedValue(true)`, so resetting drops it to `undefined`
    // and every later delete resolves undefined — which `deleteEmailMapImage`
    // turns into a TypeError that the route then swallows, quietly putting
    // tests on the failure path while they still pass.
    afterEach(() => {
      vi.mocked(deleteMediaFile).mockReset().mockResolvedValue(true)
    })

    const deleteStatusRequest = (statusId: string, query = '') =>
      DELETE(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}${query}`,
          { method: 'DELETE', headers: { Origin: 'https://llun.test' } }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

    it('queues the federation delete with the audience the status had', async () => {
      const { statusId } = await createNoteWithMedia('queues-federation')

      const response = await deleteStatusRequest(statusId)

      expect(response.status).toBe(200)
      await expect(
        database.getStatus({ statusId, withReplies: false })
      ).resolves.toBeNull()
      // The row is gone by now, so the job can only learn the audience from
      // what the action captured into this payload.
      expect(getQueue().publish).toHaveBeenCalledWith(
        expect.objectContaining({
          name: SEND_DELETE_NOTE_JOB_NAME,
          data: {
            actorId: ACTOR1_ID,
            statusId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: []
          }
        })
      )
    })

    it('destroys media rows and storage files when delete_media is true', async () => {
      const { statusId, media } = await createNoteWithMedia('with-media')

      const response = await deleteStatusRequest(statusId, '?delete_media=true')

      expect(response.status).toBe(200)
      await expect(
        database.getStatus({ statusId, withReplies: false })
      ).resolves.toBeNull()

      const actor = await database.getActorFromId({ id: ACTOR1_ID })
      await expect(
        database.getMediaByIdForAccount({
          mediaId: media.id,
          accountId: actor!.account!.id
        })
      ).resolves.toBeNull()
      expect(deleteMediaFile).toHaveBeenCalledWith(
        expect.anything(),
        'medias/api-delete-with-media.webp'
      )
      expect(deleteMediaFile).toHaveBeenCalledWith(
        expect.anything(),
        'medias/api-delete-with-media-thumb.webp'
      )
    })

    const createNoteWithFitnessEmailCopy = async (suffix: string) => {
      const { statusId } = await createNoteWithMedia(suffix)
      const fitnessFile = await database.createFitnessFile({
        actorId: ACTOR1_ID,
        statusId,
        path: `fitness/api-delete-${suffix}.fit`,
        fileName: `api-delete-${suffix}.fit`,
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 2_048
      })
      expect(fitnessFile).toBeDefined()
      await database.updateFitnessFileActivityData(fitnessFile!.id, {
        hasMapData: true,
        mapImagePath: `medias/api-delete-${suffix}.webp`,
        mapImageEmailPath: `medias/api-delete-${suffix}.jpg`
      })
      return { statusId, fitnessFileId: fitnessFile!.id }
    }

    it('deletes the route map email copy when delete_media is true', async () => {
      const { statusId, fitnessFileId } =
        await createNoteWithFitnessEmailCopy('email-copy')

      const response = await deleteStatusRequest(statusId, '?delete_media=true')

      expect(response.status).toBe(200)
      // The copy has no `medias` row, so it is not in status.attachments and
      // the media-manager flow cannot reach it. Without this the WebP the post
      // displayed is destroyed while the JPEG of the same map stays fetchable.
      expect(deleteMediaFile).toHaveBeenCalledWith(
        expect.anything(),
        'medias/api-delete-email-copy.jpg'
      )
      const fitnessFile = await database.getFitnessFile({ id: fitnessFileId })
      expect(fitnessFile?.mapImageEmailPath).toBeUndefined()
    })

    it('keeps the route map email copy when delete_media is not requested', async () => {
      const { statusId, fitnessFileId } =
        await createNoteWithFitnessEmailCopy('email-copy-kept')

      const response = await deleteStatusRequest(statusId)

      expect(response.status).toBe(200)
      expect(deleteMediaFile).not.toHaveBeenCalledWith(
        expect.anything(),
        'medias/api-delete-email-copy-kept.jpg'
      )
      const fitnessFile = await database.getFitnessFile({ id: fitnessFileId })
      expect(fitnessFile?.mapImageEmailPath).toBe(
        'medias/api-delete-email-copy-kept.jpg'
      )
    })

    it('still reports success when deleting the email copy fails', async () => {
      const { statusId, fitnessFileId } =
        await createNoteWithFitnessEmailCopy('email-copy-err')
      // Target the copy by PATH, not by call order: the status's own media is
      // deleted first, so a `mockRejectedValueOnce` is eaten by that call and
      // this passes without the email copy ever failing.
      vi.mocked(deleteMediaFile).mockImplementation(async (_database, path) => {
        if (path.endsWith('.jpg')) throw new Error('storage unavailable')
        return true
      })

      const response = await deleteStatusRequest(statusId, '?delete_media=true')

      // The status is already gone by then, so a cleanup hiccup must not read
      // to the client as "your post is still there".
      expect(response.status).toBe(200)
      await expect(
        database.getStatus({ statusId, withReplies: false })
      ).resolves.toBeNull()
      // The column is cleared even though the file could not be removed,
      // leaving a plain orphan for cleanupMediaStorage rather than a live row
      // pointing at a half-deleted object.
      const fitnessFile = await database.getFitnessFile({ id: fitnessFileId })
      expect(fitnessFile?.mapImageEmailPath).toBeUndefined()
    })

    it('clears the email copy reference before deleting the file', async () => {
      const { statusId } =
        await createNoteWithFitnessEmailCopy('email-copy-ord')
      // Spy AFTER the setup writes, so the first recorded call is the route's.
      const updateSpy = vi.spyOn(database, 'updateFitnessFileActivityData')

      try {
        const response = await deleteStatusRequest(
          statusId,
          '?delete_media=true'
        )
        expect(response.status).toBe(200)

        // Ordering is the invariant, and the resulting column state cannot show
        // it: deleteEmailMapImage swallows storage errors, so the column ends
        // up null either way. Compare when the two calls actually happened —
        // `mock.calls` and `mock.invocationCallOrder` are parallel arrays.
        const deleteMock = vi.mocked(deleteMediaFile).mock
        const copyIndex = deleteMock.calls.findIndex((call) =>
          call[1].endsWith('.jpg')
        )

        expect(updateSpy.mock.invocationCallOrder).toHaveLength(1)
        expect(copyIndex).toBeGreaterThanOrEqual(0)
        expect(updateSpy.mock.invocationCallOrder[0]).toBeLessThan(
          deleteMock.invocationCallOrder[copyIndex]
        )
      } finally {
        // Restore in a finally: a failed assertion above would otherwise leave
        // the spy installed for the rest of this file.
        updateSpy.mockRestore()
      }
    })

    it('still reports success when clearing the email copy reference fails', async () => {
      const { statusId } = await createNoteWithFitnessEmailCopy('email-copy-db')
      // The null-out is the only statement in that block that can throw —
      // deleteEmailMapImage swallows storage errors itself — so this is what
      // actually exercises the catch.
      const updateSpy = vi
        .spyOn(database, 'updateFitnessFileActivityData')
        .mockRejectedValueOnce(new Error('database unavailable'))

      try {
        const response = await deleteStatusRequest(
          statusId,
          '?delete_media=true'
        )

        expect(response.status).toBe(200)
        await expect(
          database.getStatus({ statusId, withReplies: false })
        ).resolves.toBeNull()
      } finally {
        updateSpy.mockRestore()
      }
    })

    it.each([
      { description: 'omits delete_media', suffix: 'keep-default', query: '' },
      {
        description: 'sends delete_media=false',
        suffix: 'keep-false',
        query: '?delete_media=false'
      }
    ])(
      'keeps media rows for redrafting when the client $description',
      async ({ suffix, query }) => {
        const { statusId, media } = await createNoteWithMedia(suffix)

        const response = await deleteStatusRequest(statusId, query)

        expect(response.status).toBe(200)
        const actor = await database.getActorFromId({ id: ACTOR1_ID })
        await expect(
          database.getMediaByIdForAccount({
            mediaId: media.id,
            accountId: actor!.account!.id
          })
        ).resolves.not.toBeNull()
        expect(deleteMediaFile).not.toHaveBeenCalled()
      }
    )
  })
})
