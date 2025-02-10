import { enableFetchMocks } from 'jest-fetch-mock'

import { userAnnounce } from '@/lib/actions/announce'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Actor } from '@/lib/models/actor'
import { StatusType } from '@/lib/models/status'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/jsonld/activitystream'

enableFetchMocks()

describe('Announce action', () => {
  const database = getTestSQLDatabase()
  let actor1: Actor

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)

    actor1 = (await database.getActorFromEmail({
      email: seedActor1.email
    })) as Actor
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  describe('#userAnnounce', () => {
    it('create announce status and send to followers inbox', async () => {
      const status = await userAnnounce({
        currentActor: actor1,
        statusId: `${actor1.id}/statuses/post-2`,
        database
      })

      const originalStatus = await database.getStatus({
        statusId: `${actor1.id}/statuses/post-2`
      })
      expect(status).toMatchObject({
        type: StatusType.enum.Announce,
        originalStatus
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
      const status = await userAnnounce({
        currentActor: actor1,
        statusId: `${actor1.id}/statuses/post-3`,
        database
      })
      expect(status).not.toBeNull()

      const duplicateStatus = await userAnnounce({
        currentActor: actor1,
        statusId: `${actor1.id}/statuses/post-3`,
        database
      })
      expect(duplicateStatus).toBeNull()
    })
  })
})
