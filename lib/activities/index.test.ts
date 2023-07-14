/** eslint-disable @typescript-eslint/no-explicit-any */
import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import {
  follow,
  getPublicProfileFromHandle,
  getWebfingerSelf,
  sendNote
} from '.'
import { Actor } from '../models/actor'
import { SqlStorage } from '../storage/sql'
import { mockRequests } from '../stub/activities'
import { MockActor } from '../stub/actor'
import { MockMastodonNote } from '../stub/note'
import { MockPerson } from '../stub/person'
import { ACTOR1_ID, seedActor1 } from '../stub/seed/actor1'
import { TEST_SHARED_INBOX, seedStorage } from '../stub/storage'
import { CreateStatus } from './actions/createStatus'

enableFetchMocks()
jest.mock('../config')

describe('activities', () => {
  const storage = new SqlStorage({
    client: 'sqlite3',
    useNullAsDefault: true,
    connection: {
      filename: ':memory:'
    }
  })
  let actor1: Actor | undefined

  beforeAll(async () => {
    await storage.migrate()
    await seedStorage(storage)

    actor1 = await storage.getActorFromEmail({ email: seedActor1.email })
  })

  afterAll(async () => {
    if (!storage) return
    await storage.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  describe('#getWebfingerSelf', () => {
    it('returns self href from the webfinger', async () => {
      const selfUrl = await getWebfingerSelf('test1@llun.test')
      expect(selfUrl).toEqual('https://llun.test/users/test1')
    })

    it('returns null for not found account', async () => {
      const selfUrl = await getWebfingerSelf('notexist@llun.test')
      expect(selfUrl).toBeNull()
    })
  })

  describe('#getPublicProfileFromHandle', () => {
    it('get url from webFinger and getPerson info from user id', async () => {
      const person = await getPublicProfileFromHandle('@test1@llun.test')
      expect(person).toMatchObject({
        ...MockPerson({
          id: ACTOR1_ID
        }),
        createdAt: expect.toBeNumber()
      })
    })
  })

  describe('#sendNote', () => {
    it('fetch to shared inbox', async () => {
      const actor = MockActor({})
      const note = MockMastodonNote({
        content: '<p>Hello</p>',
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: ['https://chat.llun.dev/users/me/followers']
      })

      await sendNote({
        currentActor: actor,
        inbox: TEST_SHARED_INBOX,
        note
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [, options] = fetchMock.mock.lastCall as any
      const { body } = options
      const data = JSON.parse(body) as CreateStatus
      const object = data.object
      expect(object.content).toEqual('<p>Hello</p>')
      expect(object.to).toContain(
        'https://www.w3.org/ns/activitystreams#Public'
      )
      expect(object.cc).toContain('https://chat.llun.dev/users/me/followers')
    })
  })

  describe('#follow', () => {
    it('sends follow request to user inbox', async () => {
      if (!actor1) fail('Actor1 is required')

      const targetId = 'https://somewhere.test/actors/test1'
      await follow('follow-id', actor1, targetId)
      const firstCall = fetchMock.mock.calls[0]
      expect(firstCall[0]).toEqual(targetId)

      const secondCall = fetchMock.mock.calls[1]
      expect(secondCall[0]).toEqual('https://somewhere.test/actors/test1/inbox')
      expect(secondCall[1]).toMatchObject({
        method: 'POST'
      })

      const followBody = JSON.parse(secondCall[1]?.body as string)
      expect(followBody).toMatchObject({
        id: 'https://llun.test/follow-id',
        type: 'Follow',
        actor: actor1.id,
        object: targetId
      })
    })
  })
})
