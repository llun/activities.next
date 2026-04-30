import { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { MockMastodonActivityPubNote } from '@/lib/stub/note'
import { MockActivityPubPerson } from '@/lib/stub/person'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/activitypub'
import { AnnounceAction } from '@/lib/types/activitypub/activities'
import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { getActorPerson } from './getActorPerson'
import { getActorPosts } from './getActorPosts'

enableFetchMocks()

describe('#getActorPosts', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  it('returns posts with total posts actor have', async () => {
    const person = (await getActorPerson({
      actorId: ACTOR1_ID
    })) as Actor
    const response = await getActorPosts({ database, person })
    expect(response).toMatchObject({
      statusesCount: 10,
      statuses: [
        {
          id: expect.stringContaining(ACTOR1_ID),
          actorId: ACTOR1_ID,
          isLocalActor: false,
          createdAt: expect.toBeNumber(),
          updatedAt: expect.toBeNumber(),
          type: 'Note',
          url: expect.stringContaining(ACTOR1_ID),
          text: expect.toBeString()
        },
        {
          id: expect.stringContaining(ACTOR1_ID),
          actorId: ACTOR1_ID,
          isLocalActor: false,
          createdAt: expect.toBeNumber(),
          updatedAt: expect.toBeNumber(),
          type: 'Note',
          url: expect.stringContaining(ACTOR1_ID),
          text: expect.toBeString()
        },
        {
          id: expect.stringContaining(ACTOR1_ID),
          actorId: ACTOR1_ID,
          isLocalActor: false,
          createdAt: expect.toBeNumber(),
          updatedAt: expect.toBeNumber(),
          type: 'Note',
          url: expect.stringContaining(ACTOR1_ID),
          text: expect.toBeString()
        }
      ]
    })
  })

  it('keeps the boost actor on Announce and does not assign it to the original status', async () => {
    const boosterActorId = 'https://boost.example/users/booster'
    const originalActorId = 'https://origin.example/users/original'
    const originalStatusId = `${originalActorId}/statuses/original-1`
    const announceStatusId = `${boosterActorId}/statuses/announce-1/activity`
    const published = Date.now()

    const boosterActor = await database.createActor({
      actorId: boosterActorId,
      username: 'booster',
      domain: 'boost.example',
      followersUrl: `${boosterActorId}/followers`,
      inboxUrl: `${boosterActorId}/inbox`,
      sharedInboxUrl: 'https://boost.example/inbox',
      publicKey: 'public key',
      createdAt: published
    })
    if (!boosterActor) throw new Error('Failed to create booster actor')

    const person = MockActivityPubPerson({
      id: boosterActorId,
      withContext: true
    }) as Actor

    fetchMock.resetMocks()
    fetchMock.mockResponse(async (req) => {
      if (req.url === `${boosterActorId}/outbox`) {
        return {
          status: 200,
          body: JSON.stringify({
            id: `${boosterActorId}/outbox`,
            type: 'OrderedCollection',
            totalItems: 1,
            first: `${boosterActorId}/outbox?page=true`
          })
        }
      }

      if (req.url === `${boosterActorId}/outbox?page=true`) {
        return {
          status: 200,
          body: JSON.stringify({
            id: `${boosterActorId}/outbox?page=true`,
            type: 'OrderedCollectionPage',
            partOf: `${boosterActorId}/outbox`,
            orderedItems: [
              {
                id: announceStatusId,
                type: AnnounceAction,
                actor: boosterActorId,
                published: new Date(published).toISOString(),
                to: [ACTIVITY_STREAM_PUBLIC],
                cc: [`${boosterActorId}/followers`],
                object: originalStatusId
              }
            ]
          })
        }
      }

      if (req.url === originalStatusId) {
        return {
          status: 200,
          body: JSON.stringify(
            MockMastodonActivityPubNote({
              id: originalStatusId,
              from: originalActorId,
              content: 'Original status text',
              withContext: true
            })
          )
        }
      }

      return { status: 404, body: 'Not Found' }
    })

    const response = await getActorPosts({ database, person })
    const announceStatus = response.statuses[0]

    expect(announceStatus.type).toBe(StatusType.enum.Announce)
    if (announceStatus.type !== StatusType.enum.Announce) {
      throw new Error('Expected Announce status')
    }

    expect(announceStatus.actorId).toBe(boosterActorId)
    expect(announceStatus.actor?.id).toBe(boosterActorId)
    expect(announceStatus.originalStatus.actorId).toBe(originalActorId)
    expect(announceStatus.originalStatus.actor?.id).not.toBe(boosterActorId)
    expect(announceStatus.originalStatus.text).toBe('Original status text')
  })
})
