import { enableFetchMocks } from 'jest-fetch-mock'

import { userAnnounce } from '@/lib/actions/announce'
import { getSQLStorage } from '@/lib/database/sql'
import { Actor } from '@/lib/models/actor'
import { StatusType } from '@/lib/models/status'
import { mockRequests } from '@/lib/stub/activities'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { seedStorage } from '@/lib/stub/storage'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/jsonld/activitystream'

enableFetchMocks()

describe('Announce action', () => {
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

  describe('#userAnnounce', () => {
    it('create announce status and send to followers inbox', async () => {
      if (!actor1) {
        fail('Actor1 is required')
      }
      const status = await userAnnounce({
        currentActor: actor1,
        statusId: `${actor1.id}/statuses/post-2`,
        storage
      })

      const originalStatus = await storage.getStatus({
        statusId: `${actor1.id}/statuses/post-2`
      })
      expect(status?.data).toMatchObject({
        type: StatusType.enum.Announce,
        originalStatus: originalStatus?.data
      })

      const lastCall = fetchMock.mock.lastCall
      const body = JSON.parse(lastCall?.[1]?.body as string)
      expect(lastCall?.[0]).toEqual('https://somewhere.test/inbox')
      expect(body).toMatchObject({
        id: `${status?.id}/activity`,
        type: 'Announce',
        actor: actor1.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [actor1.id, actor1.followersUrl],
        object: 'https://llun.test/users/test1/statuses/post-2'
      })
    })

    it('does not create duplicate announce', async () => {
      if (!actor1) {
        fail('Actor1 is required')
      }
      const status = await userAnnounce({
        currentActor: actor1,
        statusId: `${actor1.id}/statuses/post-3`,
        storage
      })
      expect(status).not.toBeNull()

      const duplicateStatus = await userAnnounce({
        currentActor: actor1,
        statusId: `${actor1.id}/statuses/post-3`,
        storage
      })
      expect(duplicateStatus).toBeNull()
    })
  })
})
