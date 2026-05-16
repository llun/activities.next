import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { updateNoteFromUserInput } from '@/lib/actions/updateNote'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { SEND_UPDATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import * as timelinesService from '@/lib/services/timelines'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'

enableFetchMocks()

jest.mock('@/lib/services/queue', () => ({
  getQueue: jest.fn().mockReturnValue({
    publish: jest.fn().mockResolvedValue(undefined)
  })
}))

jest.mock('@/lib/services/timelines', () => ({
  addStatusToTimelines: jest.fn().mockResolvedValue(undefined)
}))

describe('Update note action', () => {
  const database = getTestSQLDatabase()
  let actor1: Actor | undefined

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    actor1 = await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
    jest.clearAllMocks()
  })

  describe('#updateNoteFromUserInput', () => {
    it('update status to new text', async () => {
      if (!actor1) fail('Actor1 is required')
      const statusId = `${actor1.id}/statuses/post-1`

      const status = (await updateNoteFromUserInput({
        statusId,
        currentActor: actor1,
        database,
        text: '<p>This is an updated note</p>'
      })) as Status

      expect(status).toMatchObject({
        actorId: actor1.id,
        text: '<p>This is an updated note</p>',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        edits: expect.toBeArrayOfSize(1)
      })

      expect(getQueue().publish).toHaveBeenCalledTimes(1)
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: getHashFromString(statusId),
        name: SEND_UPDATE_NOTE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId
        }
      })
      expect(timelinesService.addStatusToTimelines).toHaveBeenCalledWith(
        database,
        status
      )
    })

    it('format text when updating text', async () => {
      if (!actor1) fail('Actor1 is required')

      const status = await updateNoteFromUserInput({
        statusId: `${actor1.id}/statuses/post-1`,
        currentActor: actor1,
        database,
        text: 'This is markdown **text** that should get format'
      })

      expect(status).toMatchObject({
        text: 'This is markdown **text** that should get format'
      })
    })

    it('updates content warning without changing text', async () => {
      if (!actor1) fail('Actor1 is required')
      const statusId = `${actor1.id}/statuses/post-1`
      const before = await database.getStatus({ statusId })
      if (!before || before.type !== 'Note') fail('Note is required')

      const status = (await updateNoteFromUserInput({
        statusId,
        currentActor: actor1,
        database,
        summary: 'Updated warning'
      })) as Status

      expect(status).toMatchObject({
        text: before.text,
        summary: 'Updated warning'
      })

      expect(getQueue().publish).toHaveBeenCalledTimes(1)
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: getHashFromString(statusId),
        name: SEND_UPDATE_NOTE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId
        }
      })
    })

    it('does not publish when publish is false', async () => {
      if (!actor1) fail('Actor1 is required')
      const statusId = `${actor1.id}/statuses/post-1`

      const status = (await updateNoteFromUserInput({
        statusId,
        currentActor: actor1,
        database,
        summary: 'Draft warning',
        publish: false
      })) as Status

      expect(status).toMatchObject({
        summary: 'Draft warning'
      })
      expect(timelinesService.addStatusToTimelines).toHaveBeenCalledWith(
        database,
        status
      )
      expect(getQueue().publish).not.toHaveBeenCalled()
    })

    it('replaces attachments without changing note text', async () => {
      if (!actor1) fail('Actor1 is required')
      const statusId = `${actor1.id}/statuses/update-note-attachments`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: actor1.id,
        text: 'Original note with media',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const oldMedia = await database.createMedia({
        actorId: actor1.id,
        original: {
          path: 'medias/action-old.webp',
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 100, height: 100 },
          fileName: 'action-old.jpg'
        }
      })
      const newMedia = await database.createMedia({
        actorId: actor1.id,
        original: {
          path: 'medias/action-new.webp',
          bytes: 2048,
          mimeType: 'image/png',
          metaData: { width: 300, height: 200 },
          fileName: 'action-new.png'
        }
      })
      expect(oldMedia).not.toBeNull()
      expect(newMedia).not.toBeNull()
      await database.createAttachment({
        actorId: actor1.id,
        statusId,
        mediaType: oldMedia!.original.mimeType,
        url: 'https://llun.test/api/v1/files/medias/action-old.webp',
        width: 100,
        height: 100,
        name: 'action-old.jpg',
        mediaId: oldMedia!.id
      })

      const status = await updateNoteFromUserInput({
        statusId,
        currentActor: actor1,
        database,
        attachments: [
          {
            type: 'upload',
            id: newMedia!.id,
            mediaType: newMedia!.original.mimeType,
            url: 'https://llun.test/api/v1/files/medias/action-new.webp',
            width: 300,
            height: 200,
            name: 'action-new.png'
          }
        ]
      })

      if (!status || status.type !== 'Note') fail('Updated note is required')
      expect(status).toMatchObject({
        text: 'Original note with media',
        attachments: [
          expect.objectContaining({
            mediaId: String(newMedia!.id),
            url: 'https://llun.test/api/v1/files/medias/action-new.webp'
          })
        ]
      })
      expect(status.attachments).toHaveLength(1)
      expect(
        await database.getMediaByIdForAccount({
          mediaId: oldMedia!.id,
          accountId: actor1.account!.id
        })
      ).not.toBeNull()
      expect(getQueue().publish).toHaveBeenCalledTimes(1)
    })
  })
})
