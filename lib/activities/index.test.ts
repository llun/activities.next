/** eslint-disable @typescript-eslint/no-explicit-any */
import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { follow, sendNote } from '@/lib/activities'
import { CreateStatus } from '@/lib/activities/actions/createStatus'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Actor } from '@/lib/models/actor'
import { mockRequests } from '@/lib/stub/activities'
import { MockActor } from '@/lib/stub/actor'
import { TEST_SHARED_INBOX, seedDatabase } from '@/lib/stub/database'
import { MockMastodonActivityPubNote } from '@/lib/stub/note'
import { seedActor1 } from '@/lib/stub/seed/actor1'

enableFetchMocks()

describe('activities', () => {
  const database = getTestSQLDatabase()
  let actor1: Actor | undefined

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)

    actor1 = await database.getActorFromEmail({ email: seedActor1.email })
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  describe('#sendNote', () => {
    it('fetch to shared inbox', async () => {
      const actor = MockActor({})
      const note = MockMastodonActivityPubNote({
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
