import { enableFetchMocks } from 'jest-fetch-mock'

import { AnnounceStatus } from '@/lib/activities/announceStatus'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { createAnnounceJob } from '@/lib/jobs/createAnnounceJob'
import { CREATE_ANNOUNCE_JOB_NAME } from '@/lib/jobs/names'
import { mockRequests } from '@/lib/stub/activities'
import { MockAnnounceStatus } from '@/lib/stub/announce'
import { seedDatabase } from '@/lib/stub/database'
import { stubNoteId } from '@/lib/stub/note'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'
import {
  Status,
  StatusAnnounce,
  StatusNote,
  StatusPoll,
  StatusType
} from '@/lib/types/domain/status'

enableFetchMocks()

describe('Announce action', () => {
  const database = getTestSQLDatabase()
  let actor1: Actor | null = null
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

  it('does not create announces from blocked actor domains', async () => {
    const statusId = 'https://blocked-announce.test/statuses/boost-1'
    const announceStatusId =
      'https://somewhere.test/statuses/blocked-announce-target'
    await database.createDomainBlock({
      domain: 'blocked-announce.test',
      severity: 'suspend'
    })

    await expect(
      createAnnounceJob(database, {
        id: 'id',
        name: CREATE_ANNOUNCE_JOB_NAME,
        data: MockAnnounceStatus({
          actorId: 'https://blocked-announce.test/actors/bad',
          statusId,
          announceStatusId
        })
      })
    ).rejects.toThrow('Federation with actor domain is blocked')

    await expect(
      database.getStatus({ statusId: `${statusId}/activity` })
    ).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalledWith(announceStatusId)
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
      createdAt: expect.any(Number)
    })
    const originalStatusActor = await database.getActorFromId({
      id: friend2Id
    })
    expect(originalStatusActor).toBeDefined()
    expect(originalStatusActor).toMatchObject({
      id: friend2Id,
      username: 'friend2',
      domain: 'somewhere.test',
      createdAt: expect.any(Number)
    })
  })

  it('loads announce Question status (poll) and saves it locally as a poll', async () => {
    const statusId = stubNoteId()
    const announceStatusId = 'https://somewhere.test/statuses/announce-poll'
    const pollCreator = 'https://somewhere.test/actors/pollcreator'
    fetchMock.mockOnceIf(
      announceStatusId,
      JSON.stringify({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: announceStatusId,
        type: 'Question',
        attributedTo: pollCreator,
        content: '<p>What is your favorite color?</p>',
        published: '2026-08-30T04:27:44Z',
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: [],
        oneOf: [
          {
            type: 'Note',
            name: 'Red',
            replies: { type: 'Collection', totalItems: 10 }
          },
          {
            type: 'Note',
            name: 'Blue',
            replies: { type: 'Collection', totalItems: 20 }
          }
        ]
      })
    )

    await createAnnounceJob(database, {
      id: 'id-poll-announce',
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
    })) as StatusPoll
    expect(boostedStatus).toBeDefined()
    expect(boostedStatus.type).toEqual(StatusType.enum.Poll)
    expect(boostedStatus.choices).toEqual([
      expect.objectContaining({ title: 'Red' }),
      expect.objectContaining({ title: 'Blue' })
    ])
    expect(status.originalStatus).toEqual(boostedStatus)
  })

  it('ignores an announce whose fetched object claims a different status id', async () => {
    // A hostile server answers the announced URL with a document whose
    // self-reported `id` is an existing status it does not own. createNoteJob
    // no-ops on the already-stored id, so trusting it would attribute this
    // Announce to that status — a forged boost of a post the announcer never
    // saw, fanned out on the ANNOUNCE's own recipients.
    const statusId = stubNoteId()
    const announcedObjectId = 'https://somewhere.test/statuses/id-spoof-source'
    const victimStatusId = `${actor1?.id}/statuses/post-2`

    const victimBefore = await database.getStatus({ statusId: victimStatusId })
    if (victimBefore?.type !== StatusType.enum.Note) {
      fail('Victim fixture must be a stored Note')
    }

    fetchMock.mockOnceIf(
      announcedObjectId,
      JSON.stringify({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: victimStatusId,
        type: 'Note',
        attributedTo: 'https://somewhere.test/actors/spoofer',
        content: '<p>spoofed</p>',
        published: '2026-08-30T04:27:44Z',
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: []
      })
    )

    await expect(
      createAnnounceJob(database, {
        id: 'id-spoofed-object',
        name: CREATE_ANNOUNCE_JOB_NAME,
        data: MockAnnounceStatus({
          actorId: ACTOR1_ID,
          statusId,
          announceStatusId: announcedObjectId
        })
      })
    ).resolves.toBeUndefined()

    // No announce row, and in particular none pointing at the victim status.
    await expect(
      database.getStatus({ statusId: `${statusId}/activity` })
    ).resolves.toBeNull()
    // Nothing was stored under the announced id either, which is what pins the
    // guard AHEAD of the createNoteJob/createPollJob dispatch: moved below it,
    // a document claiming an id we were never pointed at would still be
    // persisted, attributed to whatever `attributedTo` claims.
    await expect(
      database.getStatus({ statusId: announcedObjectId })
    ).resolves.toBeNull()
    // The victim status itself is untouched.
    const victimAfter = await database.getStatus({ statusId: victimStatusId })
    if (victimAfter?.type !== StatusType.enum.Note) {
      fail('Victim status must still be a stored Note')
    }
    expect(victimAfter.text).toEqual(victimBefore.text)
  })

  it('stores nothing when the fetched object claims an unstored id on another host', async () => {
    // The companion to the test above, and what pins the guard AHEAD of the
    // createNoteJob/createPollJob dispatch rather than merely ahead of the
    // fallback lookup. Here the claimed id is not already stored, so a guard
    // placed after the dispatch would let the child job persist a status at an
    // id the Announce never named — content planted on another server's id
    // space, attributed to whatever `attributedTo` claims.
    const statusId = stubNoteId()
    const announcedObjectId = 'https://somewhere.test/statuses/id-plant-source'
    const plantedStatusId = 'https://elsewhere.test/statuses/planted'

    fetchMock.mockOnceIf(
      announcedObjectId,
      JSON.stringify({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: plantedStatusId,
        type: 'Note',
        attributedTo: 'https://somewhere.test/actors/spoofer',
        content: '<p>planted</p>',
        published: '2026-08-30T04:27:44Z',
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: []
      })
    )

    await expect(
      createAnnounceJob(database, {
        id: 'id-planted-object',
        name: CREATE_ANNOUNCE_JOB_NAME,
        data: MockAnnounceStatus({
          actorId: ACTOR1_ID,
          statusId,
          announceStatusId: announcedObjectId
        })
      })
    ).resolves.toBeUndefined()

    await expect(
      database.getStatus({ statusId: plantedStatusId })
    ).resolves.toBeNull()
    await expect(
      database.getStatus({ statusId: announcedObjectId })
    ).resolves.toBeNull()
    await expect(
      database.getStatus({ statusId: `${statusId}/activity` })
    ).resolves.toBeNull()
  })

  it('accepts an announce whose fetched object id differs only by a default port', async () => {
    // The guard normalizes both sides, so a benign serialization difference —
    // here an explicit `:443` in the Announce against the canonical form the
    // origin serves — still resolves through the fetched-id fallback rather
    // than being dropped. The row is stored under the fetched spelling, which
    // is exactly what that fallback exists to find.
    const statusId = stubNoteId()
    const announcedObjectId =
      'https://somewhere.test:443/statuses/announce-default-port'
    const canonicalObjectId =
      'https://somewhere.test/statuses/announce-default-port'

    fetchMock.mockOnceIf(
      (input) => new URL(input.url).pathname.endsWith('announce-default-port'),
      JSON.stringify({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: canonicalObjectId,
        type: 'Note',
        attributedTo: 'https://somewhere.test/actors/friend',
        content: '<p>canonical</p>',
        published: '2026-08-30T04:27:44Z',
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: []
      })
    )

    await createAnnounceJob(database, {
      id: 'id-default-port',
      name: CREATE_ANNOUNCE_JOB_NAME,
      data: MockAnnounceStatus({
        actorId: ACTOR1_ID,
        statusId,
        announceStatusId: announcedObjectId
      })
    })

    const status = (await database.getStatus({
      statusId: `${statusId}/activity`
    })) as StatusAnnounce | null
    expect(status).not.toBeNull()
    expect(status?.originalStatus?.id).toEqual(canonicalObjectId)
  })

  it('gracefully ignores malformed announce payloads without error', async () => {
    await expect(
      createAnnounceJob(database, {
        id: 'id-malformed',
        name: CREATE_ANNOUNCE_JOB_NAME,
        data: { invalid: true } as unknown as AnnounceStatus
      })
    ).resolves.toBeUndefined()
  })

  it('gracefully ignores announce when boosted status cannot be fetched or saved', async () => {
    const statusId = stubNoteId()
    const announceStatusId =
      'https://somewhere.test/statuses/unfetchable-status'
    fetchMock.mockResponseOnce('', { status: 404 })

    await expect(
      createAnnounceJob(database, {
        id: 'id-unfetchable',
        name: CREATE_ANNOUNCE_JOB_NAME,
        data: MockAnnounceStatus({
          actorId: ACTOR1_ID,
          statusId,
          announceStatusId
        })
      })
    ).resolves.toBeUndefined()

    await expect(
      database.getStatus({ statusId: `${statusId}/activity` })
    ).resolves.toBeNull()
  })
})
