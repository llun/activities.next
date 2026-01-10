import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { updateNoteFromUserInput } from '@/lib/actions/updateNote'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { SEND_UPDATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { Actor } from '@/lib/models/actor'
import { Status } from '@/lib/models/status'
import { getQueue } from '@/lib/services/queue'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'

enableFetchMocks()

jest.mock('../services/queue', () => ({
  getQueue: jest.fn().mockReturnValue({
    publish: jest.fn().mockResolvedValue(undefined)
  })
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
  })
})
