import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { ACTIVITY_STREAM_PUBLIC } from '../jsonld/activitystream'
import { Actor } from '../models/actor'
import { SqlStorage } from '../storage/sql'
import { expectCall, mockRequests } from '../stub/activities'
import { seedActor1 } from '../stub/seed/actor1'
import { seedStorage } from '../stub/storage'
import { updateNoteFromUserInput } from './updateNote'

enableFetchMocks()
jest.mock('../config')

describe('Update note action', () => {
  const storage = new SqlStorage({
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

      const status = await updateNoteFromUserInput({
        statusId: `${actor1.id}/statuses/post-1`,
        currentActor: actor1,
        storage,
        text: '<p>This is an updated note</p>'
      })
      if (!status) fail('Status should return after update')

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
        object: status?.toObject()
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
        text: '<p>This is markdown <strong>text</strong> that should get format</p>'
      })
    })
  })
})
