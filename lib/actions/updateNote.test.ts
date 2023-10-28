import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { ACTIVITY_STREAM_PUBLIC } from '../jsonld/activitystream'
import { Actor } from '../models/actor'
import { SqlStorage } from '../storage/sql'
import { expectCall, mockRequests } from '../stub/activities'
import { seedActor1 } from '../stub/seed/actor1'
import { seedActor2 } from '../stub/seed/actor2'
import { seedStorage } from '../stub/storage'
import { updateNoteFromUserInput } from './updateNote'

enableFetchMocks()
jest.mock('../config')

// Actor id for testing pulling actor information when create status
const FRIEND_ACTOR_ID = 'https://somewhere.test/actors/friend'

describe('Update note action', () => {
  const storage = new SqlStorage({
    client: 'sqlite3',
    useNullAsDefault: true,
    connection: {
      filename: ':memory:'
    }
  })
  let actor1: Actor | undefined
  let actor2: Actor | undefined

  beforeAll(async () => {
    await storage.migrate()
    await seedStorage(storage)
    actor1 = await storage.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })
    actor2 = await storage.getActorFromUsername({
      username: seedActor2.username,
      domain: seedActor2.domain
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

      expect(status?.data).toMatchObject({
        actorId: actor1.id,
        text: '<p>This is an updated note</p>',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      expectCall(fetchMock, 'https://somewhere.test/inbox', 'POST', {
        type: 'Update',
        actor: actor1.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        object: status?.toNote()
      })
    })
  })
})
