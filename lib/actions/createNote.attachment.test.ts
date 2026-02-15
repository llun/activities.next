import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { createNoteFromUserInput } from '@/lib/actions/createNote'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import {
  PROCESS_FITNESS_FILE_JOB_NAME,
  SEND_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { Actor } from '@/lib/types/domain/actor'
import { PostBoxAttachment } from '@/lib/types/domain/attachment'
import { StatusNote } from '@/lib/types/domain/status'
import { getHashFromString } from '@/lib/utils/getHashFromString'

enableFetchMocks()

jest.mock('../services/queue', () => ({
  getQueue: jest.fn().mockReturnValue({
    publish: jest.fn().mockResolvedValue(undefined)
  })
}))

jest.mock('../services/timelines', () => ({
  addStatusToTimelines: jest.fn().mockResolvedValue(undefined)
}))

describe('Create note action with attachments', () => {
  const database = getTestSQLDatabase()
  let actor1: Actor
  let actor2: Actor

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    actor1 = (await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })) as Actor
    actor2 = (await database.getActorFromUsername({
      username: seedActor2.username,
      domain: seedActor2.domain
    })) as Actor
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

  describe('#createNoteFromUserInput with attachments', () => {
    it('creates note with attachments', async () => {
      const attachments: PostBoxAttachment[] = [
        {
          type: 'upload',
          id: 'media-id-1',
          mediaType: 'image/png',
          url: 'https://example.com/image1.png',
          width: 800,
          height: 600,
          name: 'test-image.png'
        }
      ]

      const status = (await createNoteFromUserInput({
        text: 'Post with attachment',
        currentActor: actor1,
        attachments,
        database
      })) as StatusNote

      expect(status).toMatchObject({
        actorId: actor1.id,
        text: 'Post with attachment'
      })
      expect(status.attachments).toHaveLength(1)
      expect(status.attachments[0]).toMatchObject({
        actorId: actor1.id,
        statusId: status.id,
        mediaType: 'image/png',
        url: 'https://example.com/image1.png',
        width: 800,
        height: 600,
        name: 'test-image.png'
      })

      expect(getQueue().publish).toHaveBeenCalledTimes(1)
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: getHashFromString(status.id),
        name: SEND_NOTE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId: status.id
        }
      })
    })

    it('creates reply with attachments', async () => {
      // First create a status to reply to
      const originalStatus = (await createNoteFromUserInput({
        text: 'Original post',
        currentActor: actor2,
        database
      })) as StatusNote

      const attachments: PostBoxAttachment[] = [
        {
          type: 'upload',
          id: 'media-id-2',
          mediaType: 'image/jpeg',
          url: 'https://example.com/image2.jpg',
          width: 1024,
          height: 768,
          name: 'reply-image.jpg'
        }
      ]

      const replyStatus = (await createNoteFromUserInput({
        text: '@test2@llun.test Reply with attachment',
        currentActor: actor1,
        replyNoteId: originalStatus.id,
        attachments,
        database
      })) as StatusNote

      expect(replyStatus).toMatchObject({
        actorId: actor1.id,
        text: '@test2@llun.test Reply with attachment',
        reply: originalStatus.id
      })
      expect(replyStatus.cc).toContain(ACTOR2_ID)
      expect(replyStatus.attachments).toHaveLength(1)
      expect(replyStatus.attachments[0]).toMatchObject({
        actorId: actor1.id,
        statusId: replyStatus.id,
        mediaType: 'image/jpeg',
        url: 'https://example.com/image2.jpg',
        width: 1024,
        height: 768,
        name: 'reply-image.jpg'
      })
    })

    it('creates note with multiple attachments', async () => {
      const attachments: PostBoxAttachment[] = [
        {
          type: 'upload',
          id: 'media-id-3',
          mediaType: 'image/png',
          url: 'https://example.com/image3.png',
          width: 800,
          height: 600,
          name: 'image1.png'
        },
        {
          type: 'upload',
          id: 'media-id-4',
          mediaType: 'image/jpeg',
          url: 'https://example.com/image4.jpg',
          width: 1024,
          height: 768,
          name: 'image2.jpg'
        }
      ]

      const status = (await createNoteFromUserInput({
        text: 'Post with multiple attachments',
        currentActor: actor1,
        attachments,
        database
      })) as StatusNote

      expect(status.attachments).toHaveLength(2)
      expect(status.attachments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'image1.png' }),
          expect.objectContaining({ name: 'image2.jpg' })
        ])
      )
    })

    it('creates note with linked fitness file', async () => {
      const storedFitnessFile = await database.createFitnessFile({
        actorId: actor1.id,
        path: `fitness/${Date.now()}-morning-run.fit`,
        fileName: 'morning-run.fit',
        fileType: 'fit',
        mimeType: 'application/octet-stream',
        bytes: 2048
      })

      const status = (await createNoteFromUserInput({
        text: 'Morning run with FIT file',
        currentActor: actor1,
        fitnessFileId: storedFitnessFile!.id,
        database
      })) as StatusNote

      expect(status.fitness).toMatchObject({
        id: storedFitnessFile!.id,
        fileName: 'morning-run.fit',
        fileType: 'fit',
        mimeType: 'application/octet-stream',
        bytes: 2048,
        url: `/api/v1/fitness-files/${storedFitnessFile!.id}`
      })

      const linkedFitnessFile = await database.getFitnessFile({
        id: storedFitnessFile!.id
      })
      expect(linkedFitnessFile?.statusId).toBe(status.id)
      expect(linkedFitnessFile?.processingStatus).toBe('pending')
      expect(getQueue().publish).toHaveBeenCalledTimes(1)
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: getHashFromString(status.id),
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId: status.id,
          fitnessFileId: storedFitnessFile!.id
        }
      })
    })

    it('does not create note when fitness file is owned by another actor', async () => {
      const storedFitnessFile = await database.createFitnessFile({
        actorId: actor2.id,
        path: `fitness/${Date.now()}-not-owned.fit`,
        fileName: 'not-owned.fit',
        fileType: 'fit',
        mimeType: 'application/octet-stream',
        bytes: 1024
      })

      const status = await createNoteFromUserInput({
        text: 'This should fail',
        currentActor: actor1,
        fitnessFileId: storedFitnessFile!.id,
        database
      })

      expect(status).toBeNull()
    })
  })
})
