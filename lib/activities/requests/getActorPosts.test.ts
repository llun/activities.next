import { Person } from '@llun/activities.schema'
import { enableFetchMocks } from 'jest-fetch-mock'

import { getSQLDatabase } from '@/lib/database/sql'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'

import { getActorPerson } from './getActorPerson'
import { getActorPosts } from './getActorPosts'

enableFetchMocks()

describe('#getActorPosts', () => {
  const database = getSQLDatabase({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: {
      filename: ':memory:'
    }
  })

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

  it('returns posts from outbox api', async () => {
    const person = (await getActorPerson({
      actorId: ACTOR1_ID
    })) as Person
    const posts = await getActorPosts({ database, person })
    console.log(posts)
  })
})
