import { enableFetchMocks } from 'jest-fetch-mock'

import { ACTIVITY_STREAM_PUBLIC } from '../jsonld/activitystream'
import { Actor } from '../models/actor'
import { StatusType } from '../models/status'
import { SqlStorage } from '../storage/sql'
import { mockRequests } from '../stub/activities'
import { MockAnnounceStatus } from '../stub/announce'
import { stubNoteId } from '../stub/note'
import { ACTOR1_ID, seedActor1 } from '../stub/seed/actor1'
import { seedStorage } from '../stub/storage'
import { announce, userAnnounce } from './announce'

enableFetchMocks()

describe('Announce action', () => {
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

  describe('#announce', () => {
    it('loads announce status and save it locally', async () => {
      const statusId = stubNoteId()
      const announceStatusId = 'https://somewhere.test/statuses/announce-status'
      await announce({
        status: MockAnnounceStatus({
          actorId: ACTOR1_ID,
          statusId,
          announceStatusId
        }),
        storage
      })

      const status = await storage.getStatus({
        statusId: `${statusId}/activity`
      })
      expect(status).toBeDefined()

      const boostedStatus = await storage.getStatus({
        statusId: announceStatusId
      })
      const statusData = status?.toJson()
      if (statusData?.type !== StatusType.enum.Announce) {
        fail('Status type must be announce')
      }
      expect(statusData.originalStatus).toEqual(boostedStatus?.toJson())
    })

    it('loads announce with attachments and save both locally', async () => {
      const statusId = stubNoteId()
      const announceStatusId =
        'https://somewhere.test/statuses/announce-status-attachments'
      await announce({
        status: MockAnnounceStatus({
          actorId: ACTOR1_ID,
          statusId,
          announceStatusId
        }),
        storage
      })
      const boostedStatus = await storage.getStatus({
        statusId: announceStatusId
      })
      if (boostedStatus?.data.type !== StatusType.enum.Note) {
        fail('Status type must be note')
      }
      expect(boostedStatus?.data.attachments).toHaveLength(2)
    })

    it('record content from content map if content is undefined', async () => {
      const statusId = stubNoteId()
      const announceStatusId =
        'https://somewhere.test/actors/test1/lp/litepub-status'
      await announce({
        status: MockAnnounceStatus({
          actorId: ACTOR1_ID,
          statusId,
          announceStatusId
        }),
        storage
      })
      const status = await storage.getStatus({
        statusId: `${statusId}/activity`
      })
      expect(status).toBeDefined()

      const boostedStatus = await storage.getStatus({
        statusId: announceStatusId
      })
      expect(boostedStatus).toBeDefined()
      if (boostedStatus?.data.type !== StatusType.enum.Note) {
        fail('Boost status must be note')
      }
      expect(boostedStatus.data.text).toEqual('This is litepub status')
    })

    it('does not load and create status that already exists', async () => {
      const statusId = stubNoteId()
      const announceStatusId = `${actor1?.id}/statuses/post-1`
      await announce({
        status: MockAnnounceStatus({
          actorId: ACTOR1_ID,
          statusId,
          announceStatusId
        }),
        storage
      })
      expect(fetchMock).not.toHaveBeenCalledWith(announceStatusId)
    })

    it('record actor for actor that is not exist locally', async () => {
      const friendId = 'https://somewhere.test/actors/friend'
      const friend2Id = 'https://somewhere.test/actors/friend2'
      const statusId = stubNoteId()
      const announceStatusId =
        'https://somewhere.test/s/friend2/announce-status'
      await announce({
        status: MockAnnounceStatus({
          actorId: friendId,
          statusId,
          announceStatusId
        }),
        storage
      })
      const actor = await storage.getActorFromId({ id: friendId })
      expect(actor).toBeDefined()
      expect(actor).toMatchObject({
        id: friendId,
        username: 'friend',
        domain: 'somewhere.test',
        createdAt: expect.toBeNumber()
      })

      const originalStatusActor = await storage.getActorFromId({
        id: friend2Id
      })
      expect(originalStatusActor).toBeDefined()
      expect(originalStatusActor).toMatchObject({
        id: friend2Id,
        username: 'friend2',
        domain: 'somewhere.test',
        createdAt: expect.toBeNumber()
      })
    })
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
