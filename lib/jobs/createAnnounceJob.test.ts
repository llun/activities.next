import { enableFetchMocks } from 'jest-fetch-mock'

import { Actor } from '../models/actor'
import { StatusType } from '../models/status'
import { getSQLStorage } from '../storage/sql'
import { mockRequests } from '../stub/activities'
import { MockAnnounceStatus } from '../stub/announce'
import { stubNoteId } from '../stub/note'
import { ACTOR1_ID, seedActor1 } from '../stub/seed/actor1'
import { seedStorage } from '../stub/storage'
import {
  CREATE_ANNOUNCE_JOB_NAME,
  createAnnounceJob
} from './createAnnounceJob'

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

  it('loads announce status and save it locally', async () => {
    const statusId = stubNoteId()
    const announceStatusId = 'https://somewhere.test/statuses/announce-status'
    await createAnnounceJob(storage, {
      id: 'id',
      name: CREATE_ANNOUNCE_JOB_NAME,
      data: MockAnnounceStatus({
        actorId: ACTOR1_ID,
        statusId,
        announceStatusId
      })
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
    await createAnnounceJob(storage, {
      id: 'id',
      name: CREATE_ANNOUNCE_JOB_NAME,
      data: MockAnnounceStatus({
        actorId: ACTOR1_ID,
        statusId,
        announceStatusId
      })
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
    await createAnnounceJob(storage, {
      id: 'id',
      name: CREATE_ANNOUNCE_JOB_NAME,
      data: MockAnnounceStatus({
        actorId: ACTOR1_ID,
        statusId,
        announceStatusId
      })
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
    await createAnnounceJob(storage, {
      id: 'id',
      name: CREATE_ANNOUNCE_JOB_NAME,
      data: MockAnnounceStatus({
        actorId: ACTOR1_ID,
        statusId,
        announceStatusId
      })
    })
    expect(fetchMock).not.toHaveBeenCalledWith(announceStatusId)
  })

  it('record actor for actor that is not exist locally', async () => {
    const friendId = 'https://somewhere.test/actors/friend'
    const friend2Id = 'https://somewhere.test/actors/friend2'
    const statusId = stubNoteId()
    const announceStatusId = 'https://somewhere.test/s/friend2/announce-status'
    await createAnnounceJob(storage, {
      id: 'id',
      name: CREATE_ANNOUNCE_JOB_NAME,
      data: MockAnnounceStatus({
        actorId: friendId,
        statusId,
        announceStatusId
      })
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
