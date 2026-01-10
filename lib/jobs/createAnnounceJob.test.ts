import { enableFetchMocks } from 'jest-fetch-mock'

import { AnnounceStatus } from '@/lib/activities/actions/announceStatus'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { createAnnounceJob } from '@/lib/jobs/createAnnounceJob'
import { CREATE_ANNOUNCE_JOB_NAME } from '@/lib/jobs/names'
import { Actor } from '@/lib/models/actor'
import { Status, StatusAnnounce, StatusNote } from '@/lib/models/status'
import { mockRequests } from '@/lib/stub/activities'
import { MockAnnounceStatus } from '@/lib/stub/announce'
import { seedDatabase } from '@/lib/stub/database'
import { stubNoteId } from '@/lib/stub/note'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

enableFetchMocks()

describe('Announce action', () => {
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

  it('loads announce status and save it locally', async () => {
    const statusId = stubNoteId()
    const announceStatusId = 'https://somewhere.test/statuses/announce-status'
    await createAnnounceJob(database, {
      id: 'id',
      name: CREATE_ANNOUNCE_JOB_NAME,
      data: MockAnnounceStatus({
        actorId: ACTOR1_ID,
        statusId,
        announceStatusId
      })
    })
    const status = (await database.getStatus({
      statusId: `${statusId}/activity`
    })) as StatusAnnounce
    expect(status).toBeDefined()
    const boostedStatus = (await database.getStatus({
      statusId: announceStatusId
    })) as Status
    expect(status.originalStatus).toEqual(boostedStatus)
  })

  it('accepts announce object with id field', async () => {
    const statusId = stubNoteId()
    const announceStatusId =
      'https://somewhere.test/statuses/announce-status-object'
    const announce = MockAnnounceStatus({
      actorId: ACTOR1_ID,
      statusId,
      announceStatusId
    })
    await createAnnounceJob(database, {
      id: 'id',
      name: CREATE_ANNOUNCE_JOB_NAME,
      data: {
        ...announce,
        object: { id: announceStatusId }
      } as unknown as AnnounceStatus
    })
    const status = await database.getStatus({
      statusId: `${statusId}/activity`
    })
    expect(status).toBeDefined()
  })

  it('loads announce with attachments and save both locally', async () => {
    const statusId = stubNoteId()
    const announceStatusId =
      'https://somewhere.test/statuses/announce-status-attachments'
    await createAnnounceJob(database, {
      id: 'id',
      name: CREATE_ANNOUNCE_JOB_NAME,
      data: MockAnnounceStatus({
        actorId: ACTOR1_ID,
        statusId,
        announceStatusId
      })
    })
    const boostedStatus = (await database.getStatus({
      statusId: announceStatusId
    })) as StatusNote
    expect(boostedStatus.attachments).toHaveLength(2)
  })

  it('record content from content map if content is undefined', async () => {
    const statusId = stubNoteId()
    const announceStatusId =
      'https://somewhere.test/actors/test1/lp/litepub-status'
    await createAnnounceJob(database, {
      id: 'id',
      name: CREATE_ANNOUNCE_JOB_NAME,
      data: MockAnnounceStatus({
        actorId: ACTOR1_ID,
        statusId,
        announceStatusId
      })
    })
    const status = await database.getStatus({
      statusId: `${statusId}/activity`
    })
    expect(status).toBeDefined()
    const boostedStatus = (await database.getStatus({
      statusId: announceStatusId
    })) as StatusNote
    expect(boostedStatus).toBeDefined()
    expect(boostedStatus.text).toEqual('This is litepub status')
  })

  it('does not load and create status that already exists', async () => {
    const statusId = stubNoteId()
    const announceStatusId = `${actor1?.id}/statuses/post-1`
    await createAnnounceJob(database, {
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
    await createAnnounceJob(database, {
      id: 'id',
      name: CREATE_ANNOUNCE_JOB_NAME,
      data: MockAnnounceStatus({
        actorId: friendId,
        statusId,
        announceStatusId
      })
    })
    const actor = await database.getActorFromId({ id: friendId })
    expect(actor).toBeDefined()
    expect(actor).toMatchObject({
      id: friendId,
      username: 'friend',
      domain: 'somewhere.test',
      createdAt: expect.toBeNumber()
    })
    const originalStatusActor = await database.getActorFromId({
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
