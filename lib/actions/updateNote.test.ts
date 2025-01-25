import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { updateNoteFromUserInput } from '@/lib/actions/updateNote'
import { Actor } from '@/lib/models/actor'
import { Status } from '@/lib/models/status'
import { getSQLStorage } from '@/lib/storage/sql'
import { expectCall, mockRequests } from '@/lib/stub/activities'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { seedStorage } from '@/lib/stub/storage'
import { getNoteFromStatusData } from '@/lib/utils/getNoteFromStatusData'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/jsonld/activitystream'

enableFetchMocks()

describe('Update note action', () => {
  const storage = getSQLStorage({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: {
      filename: ':memory:'
    }
  })
  let actor1: Actor | undefined

  beforeAll(async () => {
    await storage.migrate()
    await seedStorage(storage)
    actor1 = await storage.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })
  })

  afterAll(async () => {
    if (!storage) return
    await storage.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  describe('#updateNoteFromUserInput', () => {
    it('update status to new text', async () => {
      if (!actor1) fail('Actor1 is required')

      const status = (await updateNoteFromUserInput({
        statusId: `${actor1.id}/statuses/post-1`,
        currentActor: actor1,
        storage,
        text: '<p>This is an updated note</p>'
      })) as Status

      expect(status.data).toMatchObject({
        actorId: actor1.id,
        text: '<p>This is an updated note</p>',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        edits: expect.toBeArrayOfSize(1)
      })

      expectCall(fetchMock, 'https://somewhere.test/inbox', 'POST', {
        id: expect.stringMatching(status.id),
        type: 'Update',
        actor: actor1.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        object: getNoteFromStatusData(status.data)
      })
    })

    it('format text when updating text', async () => {
      if (!actor1) fail('Actor1 is required')

      const status = await updateNoteFromUserInput({
        statusId: `${actor1.id}/statuses/post-1`,
        currentActor: actor1,
        storage,
        text: 'This is markdown **text** that should get format'
      })

      expect(status?.data).toMatchObject({
        text: 'This is markdown **text** that should get format'
      })
    })
  })
})
