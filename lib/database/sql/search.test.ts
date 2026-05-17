import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
import { StatusNote } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

describe('SearchDatabase', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (_, database) => {
    beforeAll(async () => {
      await seedDatabase(database as Database)
      await database.rebuildSearchIndex({ batchSize: 25 })
    })

    it('finds accounts by partial username', async () => {
      const accounts = await database.searchAccounts({
        query: 'test',
        limit: 10,
        offset: 0
      })

      expect(accounts.map((account) => account.acct)).toContain(
        'test1@llun.test'
      )
      expect(accounts.map((account) => account.acct)).toContain(
        'test2@llun.test'
      )
    })

    it('limits account search to accepted following relationships', async () => {
      const accounts = await database.searchAccounts({
        query: 'test',
        limit: 10,
        offset: 0,
        currentActorId: ACTOR1_ID,
        following: true
      })

      expect(accounts.map((account) => account.url)).toEqual([EXTERNAL_ACTOR1])
    })

    it('finds only public statuses by indexed text', async () => {
      await database.createNote({
        id: `${ACTOR1_ID}/statuses/search-public-note`,
        url: `${ACTOR1_ID}/statuses/search-public-note`,
        actorId: ACTOR1_ID,
        text: 'Pineapple searchable public status',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createNote({
        id: `${ACTOR1_ID}/statuses/search-private-note`,
        url: `${ACTOR1_ID}/statuses/search-private-note`,
        actorId: ACTOR1_ID,
        text: 'Pineapple hidden private status',
        to: [`${ACTOR1_ID}/followers`],
        cc: []
      })

      const statuses = await database.searchStatuses({
        query: 'pineapple',
        limit: 10,
        offset: 0
      })

      expect(statuses.map((status) => status.id)).toContain(
        `${ACTOR1_ID}/statuses/search-public-note`
      )
      expect(statuses.map((status) => status.id)).not.toContain(
        `${ACTOR1_ID}/statuses/search-private-note`
      )
    })

    it('finds hashtags with Mastodon tag shape', async () => {
      const status = (await database.createNote({
        id: `${ACTOR1_ID}/statuses/search-hashtag-note`,
        url: `${ACTOR1_ID}/statuses/search-hashtag-note`,
        actorId: ACTOR1_ID,
        text: 'Tag search test',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })) as StatusNote
      await database.createTag({
        statusId: status.id,
        type: 'hashtag',
        name: '#TrailRun',
        value: 'https://llun.test/tags/TrailRun'
      })

      const hashtags = await database.searchHashtags({
        query: 'trail',
        limit: 10,
        offset: 0
      })

      expect(hashtags).toContainEqual({
        id: 'trailrun',
        name: 'TrailRun',
        url: 'https://llun.test/tags/TrailRun',
        history: []
      })
    })
  })
})
