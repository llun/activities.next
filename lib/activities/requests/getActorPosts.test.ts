import { Actor } from '@llun/activities.schema'
import { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'

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
})
